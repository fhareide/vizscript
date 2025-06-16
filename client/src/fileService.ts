import * as vscode from "vscode";
import * as path from "path";

export interface FileSearchResult {
  found: boolean;
  uri?: vscode.Uri;
  relativePath?: string;
  workspaceFolder?: vscode.WorkspaceFolder;
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
   * Updates the filePath in metadata when a file is saved
   */
  async updateFilePathInMetadata(document: vscode.TextDocument): Promise<void> {
    // This will be implemented when we add save event handling
    // For now, this is a placeholder for future enhancement
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
   * Generates a suggested file path for a script
   */
  generateSuggestedFilePath(scriptName: string, scriptType: string, scenePath: string): string {
    // Clean the script name for file system
    const cleanName = scriptName.replace(/[^a-zA-Z0-9_-]/g, "_");

    // Determine extension based on script type
    const extension = scriptType === "Container" ? ".vsc" : ".vs";

    // Create a suggested path structure
    const sceneFolder = scenePath ? path.basename(scenePath) : "scripts";

    return path.join(sceneFolder, `${cleanName}${extension}`);
  }
}
