import * as vscode from "vscode";
import * as path from "path";

export interface FileSearchResult {
  found: boolean;
  uri?: vscode.Uri;
  relativePath?: string;
  workspaceFolder?: vscode.WorkspaceFolder;
  isInWorkspace?: boolean;
  absolutePath?: string;
}

export interface FileDiffResult {
  isDifferent: boolean;
  localContent?: string;
  remoteContent: string;
  filePath: string;
}

/**
 * Service for handling local file operations and workspace integration
 */
export class FileService {
  /**
   * Attempts to find a file in the workspace by filePath
   */
  async findFileInWorkspace(filePath: string): Promise<FileSearchResult> {
    if (!filePath || filePath.trim() === "") {
      return { found: false };
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return { found: false };
    }

    // Try exact path first
    for (const folder of workspaceFolders) {
      try {
        // Try relative to workspace root
        const fullPath = vscode.Uri.joinPath(folder.uri, filePath);
        const stat = await vscode.workspace.fs.stat(fullPath);
        if (stat.type === vscode.FileType.File) {
          return {
            found: true,
            uri: fullPath,
            relativePath: filePath,
            workspaceFolder: folder,
          };
        }
      } catch {
        // File doesn't exist at this path, continue searching
      }

      try {
        // Try absolute path if it looks like one
        if (path.isAbsolute(filePath)) {
          const absoluteUri = vscode.Uri.file(filePath);
          const stat = await vscode.workspace.fs.stat(absoluteUri);
          if (stat.type === vscode.FileType.File) {
            return {
              found: true,
              uri: absoluteUri,
              relativePath: vscode.workspace.asRelativePath(absoluteUri),
              workspaceFolder: folder,
            };
          }
        }
      } catch {
        // File doesn't exist at absolute path
      }
    }

    // Try fuzzy search by filename
    const fileName = path.basename(filePath);
    const searchPattern = `**/${fileName}`;

    try {
      const files = await vscode.workspace.findFiles(searchPattern, null, 10);
      if (files.length > 0) {
        // Return the first match, but in a real scenario you might want to ask the user
        const foundFile = files[0];
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(foundFile);

        return {
          found: true,
          uri: foundFile,
          relativePath: workspaceFolder ? vscode.workspace.asRelativePath(foundFile) : foundFile.fsPath,
          workspaceFolder,
        };
      }
    } catch (error) {
      console.error("Error searching for file:", error);
    }

    return { found: false };
  }

  /**
   * Compares local file content with remote content
   */
  async compareFileContent(localUri: vscode.Uri, remoteContent: string): Promise<FileDiffResult> {
    try {
      const localDocument = await vscode.workspace.openTextDocument(localUri);
      const localContent = localDocument.getText();

      const isDifferent = localContent.trim() !== remoteContent.trim();

      return {
        isDifferent,
        localContent,
        remoteContent,
        filePath: localUri.fsPath,
      };
    } catch (error) {
      console.error("Error comparing file content:", error);
      return {
        isDifferent: true,
        remoteContent,
        filePath: localUri.fsPath,
      };
    }
  }

  /**
   * Opens a file in the editor
   */
  async openFile(
    uri: vscode.Uri,
    options?: { preview?: boolean; viewColumn?: vscode.ViewColumn },
  ): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument(uri);
    return await vscode.window.showTextDocument(document, {
      preview: options?.preview || false,
      viewColumn: options?.viewColumn || vscode.ViewColumn.Active,
    });
  }

  /**
   * Shows a diff between two contents
   */
  async showDiff(
    leftContent: string,
    rightContent: string,
    leftTitle: string,
    rightTitle: string,
    title?: string,
  ): Promise<void> {
    // Create temporary files for the diff
    const leftUri = vscode.Uri.parse(`untitled:${leftTitle}`);
    const rightUri = vscode.Uri.parse(`untitled:${rightTitle}`);

    // Open documents with content
    const leftDoc = await vscode.workspace.openTextDocument({
      content: leftContent,
      language: this.getLanguageFromExtension(leftTitle),
    });

    const rightDoc = await vscode.workspace.openTextDocument({
      content: rightContent,
      language: this.getLanguageFromExtension(rightTitle),
    });

    // Show diff
    await vscode.commands.executeCommand(
      "vscode.diff",
      leftDoc.uri,
      rightDoc.uri,
      title || `${leftTitle} ↔ ${rightTitle}`,
      { preview: true },
    );
  }

  /**
   * Shows a choice dialog for handling file differences
   */
  async showFileDifferenceChoice(
    filePath: string,
    fileName: string,
  ): Promise<"openLocal" | "openRemote" | "showDiff" | "cancel"> {
    const choice = await vscode.window.showInformationMessage(
      `Found local file "${fileName}" but content differs from Viz script.`,
      {
        modal: true,
        detail: `Local file: ${filePath}\n\nWhat would you like to do?`,
      },
      "Open Local File",
      "Open Viz Script",
      "Show Diff First",
      "Cancel",
    );

    switch (choice) {
      case "Open Local File":
        return "openLocal";
      case "Open Viz Script":
        return "openRemote";
      case "Show Diff First":
        return "showDiff";
      default:
        return "cancel";
    }
  }

  /**
   * Shows a choice dialog when local file exists (even if content matches)
   */
  async showFileFoundChoice(
    filePath: string,
    fileName: string,
    contentMatches: boolean,
  ): Promise<"openLocal" | "openRemote" | "showDiff" | "cancel"> {
    const matchText = contentMatches ? "Content matches" : "Content differs";
    const choice = await vscode.window.showInformationMessage(
      `Found local file "${fileName}". ${matchText}.`,
      {
        modal: true,
        detail: `Local file: ${filePath}\n\nWhat would you like to do?`,
      },
      "Open Local File",
      "Open Viz Script",
      ...(contentMatches ? [] : ["Show Diff First"]),
      "Cancel",
    );

    switch (choice) {
      case "Open Local File":
        return "openLocal";
      case "Open Viz Script":
        return "openRemote";
      case "Show Diff First":
        return "showDiff";
      default:
        return "cancel";
    }
  }

  /**
   * Checks if the current workspace has any folders or if files are opened directly
   */
  isInWorkspace(): boolean {
    return !!(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
  }

  /**
   * Gets the appropriate file path based on user preferences
   */
  getPreferredFilePath(uri: vscode.Uri, useAbsolute?: boolean): string {
    const config = vscode.workspace.getConfiguration("vizscript.files");
    const shouldUseAbsolute = useAbsolute ?? config.get<boolean>("useAbsolutePaths", false);

    if (shouldUseAbsolute || !this.isInWorkspace()) {
      return uri.fsPath;
    } else {
      return vscode.workspace.asRelativePath(uri);
    }
  }

  /**
   * Enhanced file search that respects user preferences and workspace context
   */
  async findFileWithPreferences(filePath: string): Promise<FileSearchResult> {
    const searchResult = await this.findFileInWorkspace(filePath);

    if (searchResult.found && searchResult.uri) {
      const isInWorkspace = this.isInWorkspace() && !!vscode.workspace.getWorkspaceFolder(searchResult.uri);
      const absolutePath = searchResult.uri.fsPath;

      return {
        ...searchResult,
        isInWorkspace,
        absolutePath,
      };
    }

    return searchResult;
  }

  /**
   * Updates the filePath in metadata when a file is saved
   */
  async updateFilePathInMetadata(document: vscode.TextDocument): Promise<void> {
    try {
      // Check if the document contains viz script metadata
      const content = document.getText();
      const lines = content.split(/\r?\n/g);

      // Simple check for metadata existence
      const hasMetadata = lines.some((line) => line.includes("VSCODE-META-START"));
      if (!hasMetadata) {
        return; // No metadata to update
      }

      // Get the preferred file path
      const preferredPath = this.getPreferredFilePath(document.uri);

      // Extract current metadata
      let inMetaSection = false;
      const metadataLines: string[] = [];

      for (const line of lines) {
        if (line.includes("VSCODE-META-START")) {
          inMetaSection = true;
          continue;
        }
        if (line.includes("VSCODE-META-END")) {
          inMetaSection = false;
          break;
        }
        if (inMetaSection) {
          const cleanLine = line.startsWith("'") ? line.substring(1) : line;
          metadataLines.push(cleanLine);
        }
      }

      if (metadataLines.length === 0) {
        return; // No valid metadata found
      }

      try {
        const metadataJson = metadataLines.join("\n");
        const metadata = JSON.parse(metadataJson);

        // Update the filePath if it's different
        if (metadata.filePath !== preferredPath) {
          metadata.filePath = preferredPath;
          metadata.lastUpdated = new Date().toISOString();

          // Update the metadata in the document
          await this.updateMetadataInDocument(document, metadata);
        }
      } catch (error) {
        console.warn("Error updating metadata filePath:", error);
      }
    } catch (error) {
      console.warn("Error in updateFilePathInMetadata:", error);
    }
  }

  /**
   * Updates metadata in a document
   */
  private async updateMetadataInDocument(document: vscode.TextDocument, metadata: any): Promise<void> {
    const workspaceEdit = new vscode.WorkspaceEdit();
    const content = document.getText();
    const lines = content.split(/\r?\n/g);

    // Find metadata section and replace it
    let startLine = -1;
    let endLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("VSCODE-META-START")) {
        startLine = i;
      }
      if (lines[i].includes("VSCODE-META-END")) {
        endLine = i;
        break;
      }
    }

    if (startLine !== -1 && endLine !== -1) {
      const newMetadataLines = this.generateMetadataBlock(metadata);
      const range = new vscode.Range(startLine, 0, endLine + 1, 0);
      workspaceEdit.replace(document.uri, range, newMetadataLines.join("\n") + "\n");
      await vscode.workspace.applyEdit(workspaceEdit);
    }
  }

  /**
   * Generates metadata block lines
   */
  private generateMetadataBlock(metadata: any): string[] {
    const lines: string[] = [];
    lines.push("' VSCODE-META-START");

    const jsonString = JSON.stringify(metadata, null, 2);
    const jsonLines = jsonString.split("\n");

    for (const line of jsonLines) {
      lines.push(`'${line}`);
    }

    lines.push("' VSCODE-META-END");
    return lines;
  }

  /**
   * Gets the appropriate language ID from file extension
   */
  private getLanguageFromExtension(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();

    switch (ext) {
      case ".vs":
      case ".viz":
      case ".v3script":
        return "viz";
      case ".vsc":
      case ".vizc":
        return "viz-con";
      case ".vs4":
      case ".viz4":
        return "viz4";
      case ".vs4c":
      case ".viz4c":
        return "viz4-con";
      case ".vs5":
      case ".viz5":
        return "viz5";
      case ".vs5c":
      case ".viz5c":
        return "viz5-con";
      default:
        return "plaintext";
    }
  }

  /**
   * Generates a suggested file path for a script based on user preferences
   */
  generateSuggestedFilePath(scriptName: string, scriptType: string, scenePath: string): string {
    // Clean the script name for file system
    const cleanName = scriptName.replace(/[^a-zA-Z0-9_-]/g, "_");

    // Determine extension based on script type
    const extension = scriptType === "Container" ? ".vsc" : ".vs";

    // Create a suggested path structure
    const sceneFolder = scenePath ? path.basename(scenePath) : "scripts";
    const relativePath = path.join(sceneFolder, `${cleanName}${extension}`);

    // Check if we should use absolute paths
    const config = vscode.workspace.getConfiguration("vizscript.files");
    const useAbsolutePaths = config.get<boolean>("useAbsolutePaths", false);

    if (useAbsolutePaths || !this.isInWorkspace()) {
      // For absolute paths, we need a base directory
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const baseUri = workspaceFolders[0].uri;
        const fullPath = vscode.Uri.joinPath(baseUri, relativePath);
        return fullPath.fsPath;
      } else {
        // No workspace, use relative path anyway
        return relativePath;
      }
    }

    return relativePath;
  }
}
