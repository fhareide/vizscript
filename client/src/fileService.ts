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

      // Normalize both contents for comparison
      const normalizedLocal = this.normalizeContentForComparison(localContent);
      const normalizedRemote = this.normalizeContentForComparison(remoteContent);

      const isDifferent = normalizedLocal !== normalizedRemote;

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
   * Normalizes content for comparison by handling line endings, whitespace, and metadata timestamps
   */
  private normalizeContentForComparison(content: string): string {
    // Step 1: Normalize line endings to LF
    let normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Step 2: Remove metadata sections that might have changing timestamps
    normalized = this.removeChangingMetadata(normalized);

    // Step 3: Normalize whitespace - trim each line and remove empty lines at start/end
    const lines = normalized.split("\n").map((line) => line.trimEnd()); // Remove trailing whitespace from each line

    // Remove empty lines from start and end
    while (lines.length > 0 && lines[0].trim() === "") {
      lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
      lines.pop();
    }

    return lines.join("\n");
  }

  /**
   * Removes or normalizes metadata that frequently changes (like timestamps)
   */
  private removeChangingMetadata(content: string): string {
    const lines = content.split("\n");
    const result: string[] = [];
    let inMetadata = false;

    for (const line of lines) {
      if (line.includes("VSCODE-META-START")) {
        inMetadata = true;
        result.push(line);
        continue;
      }

      if (line.includes("VSCODE-META-END")) {
        inMetadata = false;
        result.push(line);
        continue;
      }

      if (inMetadata) {
        // Skip or normalize changing metadata fields
        const cleanLine = line.startsWith("'") ? line.substring(1).trim() : line.trim();

        // Skip timestamp fields that frequently change
        if (
          cleanLine.includes('"lastUpdated"') ||
          cleanLine.includes('"createdAt"') ||
          cleanLine.includes('"timestamp"') ||
          cleanLine.includes('"lastModified"')
        ) {
          // Skip this line entirely or replace with normalized version
          continue;
        }

        result.push(line);
      } else {
        result.push(line);
      }
    }

    return result.join("\n");
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
      "Local File",
      "Viz Script",
      "Show Diff",
      "Cancel",
    );

    switch (choice) {
      case "Local File":
        return "openLocal";
      case "Viz Script":
        return "openRemote";
      case "Show Diff":
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
      "Local File",
      "Viz Script",
      ...(contentMatches ? [] : ["Show Diff"]),
      "Cancel",
    );

    switch (choice) {
      case "Local File":
        return "openLocal";
      case "Viz Script":
        return "openRemote";
      case "Show Diff":
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

      // Extract current metadata using the same logic as MetadataService
      let inMetaSection = false;
      const metadataLines: string[] = [];
      let metadata: any = null;

      for (const line of lines) {
        if (line.includes("VSCODE-META-START") && line.includes("VSCODE-META-END")) {
          // Single-line format: 'VSCODE-META-START{json}VSCODE-META-END
          const startIndex = line.indexOf("VSCODE-META-START") + "VSCODE-META-START".length;
          const endIndex = line.indexOf("VSCODE-META-END");

          if (startIndex < endIndex) {
            const jsonContent = line.substring(startIndex, endIndex);
            metadata = JSON.parse(jsonContent);
            break;
          }
        } else if (line.includes("VSCODE-META-START")) {
          inMetaSection = true;
          continue;
        } else if (line.includes("VSCODE-META-END")) {
          inMetaSection = false;
          break;
        } else if (inMetaSection) {
          const cleanLine = line.startsWith("'") ? line.substring(1) : line;
          metadataLines.push(cleanLine);
        }
      }

      // Parse multi-line metadata if we didn't find single-line format
      if (!metadata) {
        if (metadataLines.length === 0) {
          return; // No valid metadata found
        }

        try {
          const metadataJson = metadataLines.join("\n");
          metadata = JSON.parse(metadataJson);
        } catch (error) {
          console.warn("Error parsing metadata JSON:", error);
          return;
        }
      }

      try {
        // Update the filePath if it's different
        if (metadata.filePath !== preferredPath) {
          metadata.filePath = preferredPath;

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

    // Use the same line-by-line approach as metadataService to avoid range calculation issues
    const newLines: string[] = [];
    let inMetaSection = false;
    let metadataReplaced = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes("VSCODE-META-START") && line.includes("VSCODE-META-END")) {
        // Single-line format: both START and END on the same line
        newLines.push(...this.generateMetadataBlock(metadata, "local"));
        metadataReplaced = true;
        continue;
      } else if (line.includes("VSCODE-META-START")) {
        // Multi-line format: START marker found
        inMetaSection = true;
        newLines.push(...this.generateMetadataBlock(metadata, "local"));
        metadataReplaced = true;
        continue;
      } else if (line.includes("VSCODE-META-END")) {
        // Multi-line format: END marker found
        inMetaSection = false;
        continue; // Skip the end line as it's included in generateMetadataBlock
      } else if (!inMetaSection) {
        // Only add lines that are not part of metadata section
        newLines.push(line);
      }
    }

    if (metadataReplaced) {
      // Replace the entire document content
      const newContent = newLines.join("\n");
      const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
      workspaceEdit.replace(document.uri, fullRange, newContent);
      await vscode.workspace.applyEdit(workspaceEdit);
    }
  }

  /**
   * Generates metadata block lines with support for minified format
   */
  private generateMetadataBlock(metadata: any, sourceContext: "viz" | "local" = "local"): string[] {
    const config = vscode.workspace.getConfiguration("vizscript.metadata");
    const formatting = config.get<string>("formatting", "full");

    let formatType = "multiline";

    // Determine format type based on configuration
    switch (formatting) {
      case "oneline":
        formatType = "oneline";
        break;
      case "compact":
        formatType = "compact";
        break;
      case "full":
      default:
        formatType = "multiline";
        break;
    }

    const lines: string[] = [];
    const jsonString = JSON.stringify(metadata);

    if (formatType === "oneline") {
      // True single-line format: everything on one line
      lines.push(`' VSCODE-META-START${jsonString}VSCODE-META-END`);
    } else if (formatType === "compact") {
      // Compact 3-line format
      lines.push("' VSCODE-META-START");
      lines.push(`'${jsonString}`);
      lines.push("' VSCODE-META-END");
    } else {
      // Multi-line format (existing behavior)
      lines.push("' VSCODE-META-START");
      const prettyJsonString = JSON.stringify(metadata, null, 2);
      const jsonLines = prettyJsonString.split("\n");

      for (const line of jsonLines) {
        lines.push(`'${line}`);
      }
      lines.push("' VSCODE-META-END");
    }

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

  /**
   * Debug method to show exactly what differences exist between two contents
   */
  async debugContentDifferences(localUri: vscode.Uri, remoteContent: string): Promise<void> {
    try {
      const localDocument = await vscode.workspace.openTextDocument(localUri);
      const localContent = localDocument.getText();

      console.log("=== CONTENT COMPARISON DEBUG ===");
      console.log("Local file:", localUri.fsPath);
      console.log("Local content length:", localContent.length);
      console.log("Remote content length:", remoteContent.length);

      // Check basic trimmed comparison
      const basicEqual = localContent.trim() === remoteContent.trim();
      console.log("Basic trim comparison equal:", basicEqual);

      // Check normalized comparison
      const normalizedLocal = this.normalizeContentForComparison(localContent);
      const normalizedRemote = this.normalizeContentForComparison(remoteContent);
      const normalizedEqual = normalizedLocal === normalizedRemote;
      console.log("Normalized comparison equal:", normalizedEqual);

      if (!normalizedEqual) {
        console.log("Normalized local length:", normalizedLocal.length);
        console.log("Normalized remote length:", normalizedRemote.length);

        // Find first difference
        const minLength = Math.min(normalizedLocal.length, normalizedRemote.length);
        for (let i = 0; i < minLength; i++) {
          if (normalizedLocal[i] !== normalizedRemote[i]) {
            console.log(`First difference at position ${i}:`);
            console.log(`Local char: "${normalizedLocal[i]}" (code: ${normalizedLocal.charCodeAt(i)})`);
            console.log(`Remote char: "${normalizedRemote[i]}" (code: ${normalizedRemote.charCodeAt(i)})`);
            console.log(`Context: "${normalizedLocal.substring(Math.max(0, i - 10), i + 10)}"`);
            break;
          }
        }

        if (normalizedLocal.length !== normalizedRemote.length) {
          console.log("Length difference detected");
          if (normalizedLocal.length > normalizedRemote.length) {
            console.log("Local has extra content:", normalizedLocal.substring(normalizedRemote.length));
          } else {
            console.log("Remote has extra content:", normalizedRemote.substring(normalizedLocal.length));
          }
        }
      }

      // Check line ending differences
      const localHasCRLF = localContent.includes("\r\n");
      const remoteHasCRLF = remoteContent.includes("\r\n");
      console.log("Local has CRLF:", localHasCRLF);
      console.log("Remote has CRLF:", remoteHasCRLF);

      // Check for metadata differences
      const localHasMetadata = localContent.includes("VSCODE-META-START");
      const remoteHasMetadata = remoteContent.includes("VSCODE-META-START");
      console.log("Local has metadata:", localHasMetadata);
      console.log("Remote has metadata:", remoteHasMetadata);

      console.log("=== END DEBUG ===");
    } catch (error) {
      console.error("Error in debug method:", error);
    }
  }

  /**
   * Public method to normalize content for comparison - can be used by other modules
   */
  normalizeForComparison(content: string): string {
    return this.normalizeContentForComparison(content);
  }
}
