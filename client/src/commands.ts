import { PreviewFileSystemProvider } from "./previewFileSystemProvider";
import { SidebarProvider } from "./sidebarProvider";
import {
  getScriptParametersData,
  setScriptParameterValue,
  invokeScriptParameter as invokeParameterService,
} from "./scriptParameterService";
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from "vscode";
import * as path from "path";
import {
  ExtensionContext,
  ProgressLocation,
  QuickPickItem,
  Range,
  Selection,
  StatusBarAlignment,
  StatusBarItem,
  ThemeColor,
  Uri,
  window,
  workspace,
} from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { VizScriptObject } from "./shared/types";
import { diffWithActiveEditor } from "./showDiffWindow";
import { showMessage } from "./showMessage";
import { showPreviewWindow } from "./showPreviewWindow";
import { showUntitledWindow } from "./showUntitledWindow";
import { compileScript, compileScriptId, getVizScripts } from "./vizCommunication";
import { MetadataService } from "./metadataService";
import { FileService } from "./fileService";
import { SceneService } from "./sceneService";
import uuidByString from "uuid-by-string";
import {
  showMetadataUpdateDialog,
  showMetadataInjectionDialog,
  showMetadataValidationErrors,
  showFilePathDialog,
  MetadataDialogOptions,
} from "./metadataDialog";

async function fileExists(uri: Uri): Promise<boolean> {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Closes any existing preview tab for the given script
 */
async function closePreviewTabForScript(name: string, extension: string): Promise<void> {
  const previewPattern = `${name}(read-only)${extension}`;

  // Get all open tabs
  const tabGroups = window.tabGroups.all;

  for (const tabGroup of tabGroups) {
    for (const tab of tabGroup.tabs) {
      if (tab.input && typeof tab.input === "object" && "uri" in tab.input) {
        const tabInput = tab.input as { uri: Uri };
        // Check if this is a preview tab for our script
        if (tabInput.uri.scheme === "diff" && tabInput.uri.path.includes(previewPattern)) {
          // Close this tab
          await window.tabGroups.close(tab);
          break;
        }
      }
    }
  }
}

/**
 * Finds an existing editor for a script based on deterministic filename
 */
async function findExistingScriptEditor(
  vizId: string,
  scriptName: string,
  extension: string,
): Promise<vscode.TextEditor | null> {
  const vizIdStripped = vizId.replace("#", "");

  // Generate the same deterministic UUID and filename
  const deterministicUuid = uuidByString(`vizscript-${vizIdStripped}`);
  const filename = `${scriptName}-${deterministicUuid.substring(0, 8)}${extension}`;

  // First check all open documents (including background tabs)
  for (const document of vscode.workspace.textDocuments) {
    const docFilename = document.uri.path.split("/").pop() || "";

    // Check if this document has our deterministic filename
    if (docFilename === filename) {
      // Document found, try to get an editor for it or create one
      const existingEditor = vscode.window.visibleTextEditors.find((editor) => editor.document === document);
      if (existingEditor) {
        return existingEditor;
      } else {
        // Document exists but no visible editor, show it to get an editor
        const editor = await vscode.window.showTextDocument(document);
        return editor;
      }
    }
  }

  return null;
}

export async function saveToStorage(context: ExtensionContext, data: any): Promise<void> {
  try {
    const content = JSON.stringify(data);
    let filePath: Uri;

    if (context.storageUri) {
      filePath = Uri.joinPath(context.storageUri, "vizscriptData.json");
    } else if (context.globalStorageUri) {
      filePath = Uri.joinPath(context.globalStorageUri, "vizscriptData.json");
    } else {
      console.warn("No storageUri found in context.");
      return;
    }

    await workspace.fs.writeFile(filePath, Buffer.from(content));
  } catch (error) {
    console.error("Failed to save data to storage:", error);
  }
}

export async function loadFromStorage(context: ExtensionContext): Promise<VizScriptObject[]> {
  try {
    let filePath: Uri;

    if (context.storageUri) {
      filePath = Uri.joinPath(context.storageUri, "vizscriptData.json");
    } else if (context.globalStorageUri) {
      filePath = Uri.joinPath(context.globalStorageUri, "vizscriptData.json");
    } else {
      console.warn("No storageUri or storagePath found in context.");
      return [];
    }

    const exists = await fileExists(filePath);
    if (!exists) {
      console.warn("File does not exist:", filePath.fsPath);
      return [];
    }

    const content = await workspace.fs.readFile(filePath);
    return JSON.parse(content.toString());
  } catch (error) {
    console.error("Failed to load data from storage:", error);
    return [];
  }
}

export async function getAndDisplayVizScript(
  context: ExtensionContext,
  client: LanguageClient,
  previewFileSystemProvider: PreviewFileSystemProvider,
) {
  window.setStatusBarMessage("Fetching script list from Viz...", 5000);

  try {
    const connectionString = await getConfig();
    const selectedScript = await showVizScriptQuickPick(connectionString, context);

    if (!selectedScript) {
      throw new Error("No script selected.");
    }

    // Get the script object from storage to check for local file
    const state = await loadFromStorage(context);
    const scriptObjects: VizScriptObject[] = state;
    if (!scriptObjects) {
      throw new Error("No script objects found.");
    }

    const vizId = (<QuickPickItem>selectedScript).label;
    const scriptObject = scriptObjects.find((element) => element.vizId === vizId);
    if (!scriptObject) {
      throw new Error("No script object found.");
    }

    // Check if a local file exists for this script
    const fileService = new FileService();
    let fileSearchResult = null;
    let fileStatus = "";

    // Try to find file using metadata if available
    const metadataService = new MetadataService(client);
    const metadataResult = await metadataService.extractMetadataFromContent(scriptObject.code);

    if (metadataResult.success && metadataResult.metadata?.filePath) {
      fileSearchResult = await fileService.findFileWithPreferences(metadataResult.metadata.filePath);
    }

    // If no file found via metadata, try to find it by suggested name
    if (!fileSearchResult?.found) {
      const suggestedPath = fileService.generateSuggestedFilePath(
        scriptObject.name,
        scriptObject.type,
        scriptObject.scenePath,
      );
      fileSearchResult = await fileService.findFileWithPreferences(suggestedPath);
    }

    // Prepare menu options based on file existence
    let options: QuickPickItem[] = [];

    if (fileSearchResult?.found && fileSearchResult.uri) {
      // File exists - check if content matches
      const diffResult = await fileService.compareFileContent(fileSearchResult.uri, scriptObject.code);

      if (diffResult.isDifferent) {
        // Debug: Log the differences to help troubleshoot
        console.log("Files detected as different, debugging...");
        await fileService.debugContentDifferences(fileSearchResult.uri, scriptObject.code);

        fileStatus = `📄 Local file found: ${fileSearchResult.relativePath || fileSearchResult.absolutePath} (Content differs)`;

        // File exists but content is different
        options = [
          {
            label: "Open in new file",
            description: "Create new untitled file with Viz script content",
            detail: "Opens the script from Viz in a new untitled editor tab",
          },
          {
            label: "Compare and open existing file",
            description: "Show diff then choose local or Viz version",
            detail: "Compare local file with Viz script and choose which to keep",
          },
          {
            label: "Open local file",
            description: "Open the existing local file",
            detail: `Opens: ${fileSearchResult.relativePath || fileSearchResult.absolutePath}`,
          },
        ];
      } else {
        fileStatus = `📄 Local file found: ${fileSearchResult.relativePath || fileSearchResult.absolutePath} (Content matches)`;

        // File exists and content matches
        options = [
          {
            label: "Open existing file",
            description: "Open the local file (content matches Viz)",
            detail: `Opens: ${fileSearchResult.relativePath || fileSearchResult.absolutePath}`,
          },
          {
            label: "Open in new file",
            description: "Create new untitled file anyway",
            detail: "Opens the script from Viz in a new untitled editor tab",
          },
        ];
      }
    } else {
      fileStatus = "📄 No local file found";

      // No file exists
      options = [
        {
          label: "Open in new file",
          description: "Create new untitled file with Viz script content",
          detail: "Opens the script from Viz in a new untitled editor tab",
        },
      ];
    }

    // Add current file option if there's an active editor
    if (window.activeTextEditor) {
      options.push({
        label: "Add script to current file",
        description: "Replace current file content with Viz script",
        detail: "Replaces the content of the currently active editor",
      });
    }

    const selection = await window.showQuickPick(options, {
      matchOnDescription: true,
      matchOnDetail: false,
      placeHolder: fileStatus,
    });

    if (!selection) {
      throw new Error("No selection made.");
    }

    // Handle the selection
    switch (selection.label) {
      case "Open in new file":
        await openScriptInTextEditor(context, client, vizId, true);
        break;

      case "Add script to current file":
        await openScriptInTextEditor(context, client, vizId, false);
        break;

      case "Open existing file":
      case "Open local file":
        if (fileSearchResult?.uri) {
          await fileService.openFile(fileSearchResult.uri);
        }
        break;

      case "Compare and open existing file":
        if (fileSearchResult?.uri) {
          await handleCompareAndOpen(context, client, fileService, fileSearchResult.uri, scriptObject, vizId);
        }
        break;
    }
  } catch (error) {
    showMessage(error);
  }
}

/**
 * Handles the compare and open workflow
 */
async function handleCompareAndOpen(
  context: ExtensionContext,
  client: LanguageClient,
  fileService: FileService,
  localFileUri: vscode.Uri,
  scriptObject: VizScriptObject,
  vizId: string,
): Promise<void> {
  try {
    // First show the diff
    const localDoc = await vscode.workspace.openTextDocument(localFileUri);
    const localContent = localDoc.getText();

    await fileService.showDiff(
      localContent,
      scriptObject.code,
      `Local: ${path.basename(localFileUri.fsPath)}`,
      `Viz: ${scriptObject.name}${scriptObject.extension}`,
      `Compare ${scriptObject.name}`,
    );

    // Show choice dialog
    const choice = await vscode.window.showInformationMessage(
      `Files differ. Which version would you like to keep?`,
      {
        modal: true,
        detail: `Local file: ${vscode.workspace.asRelativePath(localFileUri)}\nViz script: ${scriptObject.name}`,
      },
      "Local File",
      "Viz Script",
      "Merge Manually",
      "Cancel",
    );

    switch (choice) {
      case "Local File":
        // Just open the local file
        await fileService.openFile(localFileUri);
        break;

      case "Viz Script":
        // Replace local file content with Viz version
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(localDoc.positionAt(0), localDoc.positionAt(localDoc.getText().length));
        edit.replace(localFileUri, fullRange, scriptObject.code);
        await vscode.workspace.applyEdit(edit);
        await fileService.openFile(localFileUri);
        vscode.window.showInformationMessage("Local file updated with Viz script content");
        break;

      case "Merge Manually":
        // Open both files side by side for manual merging
        await fileService.openFile(localFileUri, { viewColumn: vscode.ViewColumn.One });
        await openScriptInTextEditor(context, client, vizId, true);
        await vscode.commands.executeCommand("workbench.action.focusSecondEditorGroup");
        vscode.window.showInformationMessage("Files opened side by side for manual merging");
        break;

      default:
        // Cancel - do nothing
        break;
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Error during compare and open: ${error.message}`);
  }
}

export async function getAndPostVizScripts(
  context: ExtensionContext,
  sidebarProvider: SidebarProvider,
  config?: { hostname: string; port: number; selectedLayer: string },
) {
  console.log(config);
  try {
    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "Fetching scripts...",
        cancellable: false,
      },
      async (progress, token) => {
        try {
          const connectionInfo = await getConfig();
          const hostName = config.hostname || connectionInfo.hostName;
          const hostPort = config.port || connectionInfo.hostPort;
          const selectedLayer = config.selectedLayer || "MAIN_SCENE";

          progress.report({ increment: 10, message: "Loading existing scripts..." });

          // Then fetch fresh scripts from Viz Engine
          progress.report({ increment: 30, message: "Fetching fresh scripts from Viz Engine..." });
          const scripts = await getVizScripts(hostName, hostPort, context, selectedLayer, progress);

          sidebarProvider._view?.webview.postMessage({ type: "receiveScripts", value: scripts });
          return scripts;
        } catch (error) {
          throw new Error("Error fetching scripts: \n" + error);
        }
      },
    );
  } catch (error) {
    // Clear the sidebar when engine connection fails
    sidebarProvider._view?.webview.postMessage({ type: "receiveScripts", value: [] });
    showMessage(error);
  }
}

export async function openScriptInTextEditor(
  context: ExtensionContext,
  client: LanguageClient,
  vizId: string,
  newFile: boolean,
  preview: boolean = false,
) {
  try {
    const state = await loadFromStorage(context);
    const scriptObjects: VizScriptObject[] = state;

    if (!scriptObjects) {
      throw new Error("No script objects found.");
    }

    const scriptObject = scriptObjects.find((element) => element.vizId === vizId);
    if (!scriptObject) {
      throw new Error("No script object found.");
    }

    const vizIdStripped = vizId.replace("#", "");

    // Enhanced metadata processing workflow with local file integration
    const processedScript = await processScriptWithLocalFileIntegration(context, client, scriptObject, { preview });

    // Check if we should open a local file instead
    if (processedScript.openLocalFile && processedScript.localFileUri && !preview) {
      // Close any existing preview tab before opening the local file
      await closePreviewTabForScript(scriptObject.name, scriptObject.extension);

      const fileService = new FileService();
      await fileService.openFile(processedScript.localFileUri);
    } else {
      // Open as untitled, preview, or add to current file
      if (preview) {
        await showPreviewWindow(
          vizIdStripped,
          scriptObject.name,
          scriptObject.extension,
          processedScript.content,
          context,
        );
      } else if (!newFile && window.activeTextEditor) {
        // Replace entire content of current file
        const editor = window.activeTextEditor;
        const document = editor.document;

        // Replace the entire document content
        await editor.edit((editBuilder) => {
          const fullRange = new Range(document.positionAt(0), document.positionAt(document.getText().length));
          editBuilder.replace(fullRange, processedScript.content);
        });

        // Show success message
        window.showInformationMessage(`Current file replaced with script "${scriptObject.name}"`);
      } else {
        // Check if this script is already open in an editor
        const existingEditor = await findExistingScriptEditor(vizId, scriptObject.name, scriptObject.extension);

        if (existingEditor) {
          // Preserve existing metadata (especially UUID) when refreshing content
          const currentContent = existingEditor.document.getText();
          let updatedContent = processedScript.content;

          // Check if current content has metadata and preserve UUID
          const metadataService = new MetadataService(client);
          try {
            const currentLines = currentContent.split(/\r?\n/g);
            const hasCurrentMetadata = detectMetadataInLines(currentLines);

            if (hasCurrentMetadata) {
              // Extract current metadata to preserve UUID
              const currentMetadataResult = await metadataService.extractMetadataFromContent(currentContent);

              if (currentMetadataResult.success && currentMetadataResult.metadata?.UUID) {
                // Check if new content has metadata
                const newLines = updatedContent.split(/\r?\n/g);
                const hasNewMetadata = detectMetadataInLines(newLines);

                if (hasNewMetadata) {
                  // Extract new metadata and replace UUID with current one
                  const newMetadataResult = await metadataService.extractMetadataFromContent(updatedContent);

                  if (newMetadataResult.success && newMetadataResult.metadata) {
                    // Preserve the existing UUID
                    const preservedMetadata = {
                      ...newMetadataResult.metadata,
                      UUID: currentMetadataResult.metadata.UUID,
                    };

                    // Update the content with preserved metadata
                    const updateResult = await metadataService.updateMetadataInContent(
                      updatedContent,
                      preservedMetadata,
                    );
                    if (updateResult.success) {
                      updatedContent = updateResult.content;
                    }
                  }
                }
              }
            }
          } catch (error) {
            console.warn("Error preserving metadata during refresh:", error);
            // Continue with original content if metadata processing fails
          }

          // Instead of just focusing, update the content and refresh
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new Range(
            existingEditor.document.positionAt(0),
            existingEditor.document.positionAt(existingEditor.document.getText().length),
          );
          edit.replace(existingEditor.document.uri, fullRange, updatedContent);

          // Apply the edit and wait for completion
          const success = await workspace.applyEdit(edit);

          if (success) {
            // Save cursor position and selection
            const currentPosition = existingEditor.selection.active;

            // Simply focus the editor - the WorkspaceEdit should be sufficient for most cases
            await window.showTextDocument(existingEditor.document);

            // Restore cursor position
            existingEditor.selection = new vscode.Selection(currentPosition, currentPosition);

            window.showInformationMessage(`Script "${scriptObject.name}" content updated`);
          } else {
            // Fallback to just focusing if edit fails
            await window.showTextDocument(existingEditor.document);
            window.showErrorMessage(`Failed to update content for "${scriptObject.name}"`);
          }
        } else {
          // Before creating new untitled file, check if there's a preview tab for this script and close it
          await closePreviewTabForScript(scriptObject.name, scriptObject.extension);

          // Create new untitled file
          await showUntitledWindow(
            vizIdStripped,
            scriptObject.name,
            scriptObject.extension,
            processedScript.content,
            context,
            scriptObject,
          );
        }
      }
    }

    // Show metadata processing result to user if needed
    if (processedScript.message) {
      window.showInformationMessage(processedScript.message);
    }
  } catch (error) {
    showMessage(error);
    throw error;
  }
}

export async function openScriptInTextEditorForceRefresh(
  context: ExtensionContext,
  client: LanguageClient,
  vizId: string,
) {
  try {
    const state = await loadFromStorage(context);
    const scriptObjects: VizScriptObject[] = state;

    if (!scriptObjects) {
      throw new Error("No script objects found.");
    }

    const scriptObject = scriptObjects.find((element) => element.vizId === vizId);
    if (!scriptObject) {
      throw new Error("No script object found.");
    }

    const vizIdStripped = vizId.replace("#", "");

    // Enhanced metadata processing workflow with local file integration
    const processedScript = await processScriptWithLocalFileIntegration(context, client, scriptObject, {
      preview: false,
    });

    // Check if this script is already open in an editor
    const existingEditor = await findExistingScriptEditor(vizId, scriptObject.name, scriptObject.extension);

    if (existingEditor) {
      // Preserve existing metadata (especially UUID) when refreshing content
      const currentContent = existingEditor.document.getText();
      let updatedContent = processedScript.content;

      // Check if current content has metadata and preserve UUID
      const metadataService = new MetadataService(client);
      try {
        const currentLines = currentContent.split(/\r?\n/g);
        const hasCurrentMetadata = detectMetadataInLines(currentLines);

        if (hasCurrentMetadata) {
          // Extract current metadata to preserve UUID
          const currentMetadataResult = await metadataService.extractMetadataFromContent(currentContent);

          if (currentMetadataResult.success && currentMetadataResult.metadata?.UUID) {
            // Check if new content has metadata
            const newLines = updatedContent.split(/\r?\n/g);
            const hasNewMetadata = detectMetadataInLines(newLines);

            if (hasNewMetadata) {
              // Extract new metadata and replace UUID with current one
              const newMetadataResult = await metadataService.extractMetadataFromContent(updatedContent);

              if (newMetadataResult.success && newMetadataResult.metadata) {
                // Preserve the existing UUID
                const preservedMetadata = {
                  ...newMetadataResult.metadata,
                  UUID: currentMetadataResult.metadata.UUID,
                };

                // Update the content with preserved metadata
                const updateResult = await metadataService.updateMetadataInContent(updatedContent, preservedMetadata);
                if (updateResult.success) {
                  updatedContent = updateResult.content;
                }
              }
            }
          }
        }
      } catch (error) {
        console.warn("Error preserving metadata during refresh:", error);
        // Continue with original content if metadata processing fails
      }

      // Update content of existing editor using WorkspaceEdit for better refresh
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new Range(
        existingEditor.document.positionAt(0),
        existingEditor.document.positionAt(existingEditor.document.getText().length),
      );
      edit.replace(existingEditor.document.uri, fullRange, updatedContent);

      // Apply the edit and wait for completion
      const success = await workspace.applyEdit(edit);

      if (success) {
        // Save cursor position and selection
        const currentPosition = existingEditor.selection.active;

        // Simply focus the editor - the WorkspaceEdit should be sufficient for most cases
        await window.showTextDocument(existingEditor.document);

        // Restore cursor position
        existingEditor.selection = new vscode.Selection(currentPosition, currentPosition);

        window.showInformationMessage(`Script "${scriptObject.name}" content refreshed`);
      } else {
        window.showErrorMessage(`Failed to refresh content for "${scriptObject.name}"`);
      }
    } else {
      // No existing editor found, open normally
      await showUntitledWindow(
        vizIdStripped,
        scriptObject.name,
        scriptObject.extension,
        processedScript.content,
        context,
        scriptObject,
      );
      window.showInformationMessage(`Script "${scriptObject.name}" opened (was not previously open)`);
    }

    // Show metadata processing result to user if needed
    if (processedScript.message) {
      window.showInformationMessage(processedScript.message);
    }
  } catch (error) {
    showMessage(error);
    throw error;
  }
}

/**
 * Enhanced script opening that checks for local files and handles filePath
 */
async function processScriptWithLocalFileIntegration(
  context: ExtensionContext,
  client: LanguageClient,
  scriptObject: VizScriptObject,
  options: { preview?: boolean; forceRemote?: boolean } = {},
): Promise<{ content: string; message?: string; openLocalFile?: boolean; localFileUri?: vscode.Uri }> {
  const fileService = new FileService();
  const metadataService = new MetadataService(client);

  // Get user preferences for file handling
  const config = vscode.workspace.getConfiguration("vizscript.files");
  const preferLocalFiles = config.get<boolean>("preferLocalFiles", true);
  const promptOnDifference = config.get<boolean>("promptOnDifference", true);
  const alwaysPromptFileChoice = config.get<boolean>("alwaysPromptFileChoice", false);

  // Skip local file checking if user preferences or options indicate so
  if (!preferLocalFiles || options.forceRemote || options.preview) {
    return await processScriptWithMetadata(context, client, scriptObject, options);
  }

  // First, check if the script has metadata with filePath
  const originalContent = scriptObject.code;
  const lines = originalContent.split(/\r?\n/g);
  const hasMetadata = detectMetadataInLines(lines);

  if (hasMetadata) {
    try {
      // Extract metadata to check for filePath
      const metadataResult = await metadataService.extractMetadataFromContent(originalContent);
      if (metadataResult.success && metadataResult.metadata && metadataResult.metadata.filePath) {
        const filePath = metadataResult.metadata.filePath;

        // Try to find the local file with enhanced search
        const searchResult = await fileService.findFileWithPreferences(filePath);

        if (searchResult.found && searchResult.uri) {
          // Compare content
          const diffResult = await fileService.compareFileContent(searchResult.uri, originalContent);
          const contentMatches = !diffResult.isDifferent;

          // Determine appropriate file path for display
          const displayPath = searchResult.relativePath || searchResult.absolutePath || searchResult.uri.fsPath;

          // Handle based on content match and user preferences
          if (contentMatches && !alwaysPromptFileChoice) {
            // Content matches and user doesn't want to be prompted - open local file
            return {
              content: originalContent,
              message: `Opening local file: ${displayPath}`,
              openLocalFile: true,
              localFileUri: searchResult.uri,
            };
          } else if (!contentMatches && !promptOnDifference) {
            // Content differs but user doesn't want prompts - continue with remote
            console.log(`Local file differs but prompting disabled, using remote content for ${scriptObject.name}`);
          } else {
            // Either content differs and prompting is enabled, or user wants to always choose
            const choice = alwaysPromptFileChoice
              ? await fileService.showFileFoundChoice(displayPath, scriptObject.name, contentMatches)
              : await fileService.showFileDifferenceChoice(displayPath, scriptObject.name);

            switch (choice) {
              case "openLocal":
                return {
                  content: diffResult.localContent || originalContent,
                  message: `Opening local file: ${displayPath}`,
                  openLocalFile: true,
                  localFileUri: searchResult.uri,
                };

              case "showDiff":
                // Show diff first, then let user decide
                await fileService.showDiff(
                  diffResult.localContent || "",
                  diffResult.remoteContent,
                  "Local File",
                  "Viz Script",
                  `${scriptObject.name} - Local vs Viz`,
                );

                // Ask again after showing diff
                const afterDiffChoice = await vscode.window.showInformationMessage(
                  "After reviewing the diff, which version would you like to edit?",
                  "Local File",
                  "Viz Script",
                  "Cancel",
                );

                if (afterDiffChoice === "Local File") {
                  return {
                    content: diffResult.localContent || originalContent,
                    message: `Opening local file: ${displayPath}`,
                    openLocalFile: true,
                    localFileUri: searchResult.uri,
                  };
                } else if (afterDiffChoice === "Cancel") {
                  throw new Error("Script opening cancelled by user");
                }
                // Fall through to open remote content
                break;

              case "cancel":
                throw new Error("Script opening cancelled by user");

              // case "openRemote" or default - continue with remote content
            }
          }
        }
      }
    } catch (error) {
      console.warn("Error checking for local file:", error);
      // Continue with normal metadata processing
    }
  }

  // If no local file found or user chose remote, process normally with metadata
  return await processScriptWithMetadata(context, client, scriptObject, options);
}

/**
 * Processes script content with metadata workflow
 */
async function processScriptWithMetadata(
  context: ExtensionContext,
  client: LanguageClient,
  scriptObject: VizScriptObject,
  options: { preview?: boolean } = {},
): Promise<{ content: string; message?: string }> {
  try {
    const metadataService = new MetadataService(client);
    const originalContent = scriptObject.code;

    // Check if content already has metadata
    const lines = originalContent.split(/\r?\n/g);
    const hasMetadata = detectMetadataInLines(lines);

    if (!hasMetadata) {
      // No metadata found - check if metadata is enabled and handle accordingly
      if (!options.preview) {
        const config = vscode.workspace.getConfiguration("vizscript.metadata");
        const metadataEnabled = config.get<boolean>("enabled", true);
        const autoUpdate = config.get<boolean>("autoUpdate", false);

        if (!metadataEnabled) {
          // Metadata disabled, just return content without prompting
          return { content: originalContent };
        }

        if (autoUpdate) {
          // Auto-update enabled, inject metadata without prompting
          try {
            const result = await metadataService.injectMetadataIntoContent(originalContent, scriptObject, "viz");
            if (result.success) {
              return {
                content: result.content,
                message: result.message || `Metadata auto-added to "${scriptObject.name}"`,
              };
            } else {
              console.warn("Failed to inject metadata:", result.message);
              return { content: originalContent };
            }
          } catch (error) {
            console.error("Error injecting metadata:", error);
            return { content: originalContent };
          }
        } else {
          // Show prompt with "don't ask again" options
          const dialogResult = await showMetadataInjectionDialog(scriptObject.name);

          if (dialogResult.dontAskAgain) {
            // Update the autoUpdate setting based on user choice
            await config.update("autoUpdate", dialogResult.inject, vscode.ConfigurationTarget.Global);
          }

          if (dialogResult.inject) {
            try {
              const result = await metadataService.injectMetadataIntoContent(originalContent, scriptObject, "viz");
              if (result.success) {
                return {
                  content: result.content,
                  message: result.message || `Metadata added to "${scriptObject.name}"`,
                };
              } else {
                console.warn("Failed to inject metadata:", result.message);
                return { content: originalContent };
              }
            } catch (error) {
              console.error("Error injecting metadata:", error);
              return { content: originalContent };
            }
          } else {
            return { content: originalContent };
          }
        }
      } else {
        // In preview mode, just return the content without prompting
        return { content: originalContent };
      }
    } else {
      // Metadata exists - check if it needs validation/update or completion
      try {
        // First extract the existing metadata from content
        const metadataResult = await metadataService.extractMetadataFromContent(originalContent);

        if (!metadataResult.success || !metadataResult.metadata) {
          console.warn("Failed to extract metadata:", metadataResult.error);
          return { content: originalContent };
        }

        const existingMetadata = metadataResult.metadata;

        // Check if metadata is complete by creating default metadata and comparing
        const suggestedMetadata = metadataService.createDefaultMetadata(scriptObject);

        // Define required fields (scenePath is optional for containers, filePath is optional for collections)
        const requiredFields = ["UUID", "fileName", "scriptType", "vizVersion"];
        if (scriptObject.type === "Scene") {
          requiredFields.push("scenePath");
        }
        // Collections (groups) don't require filePath since they're opened as untitled
        if (!scriptObject.isGroup) {
          // Note: filePath is not strictly required but good to have for non-collections
          // We don't add it to requiredFields to avoid prompts for unsaved scripts
        }

        // Check for missing or empty required fields
        const missingFields: string[] = [];
        for (const field of requiredFields) {
          // For scenePath, allow empty strings (no scene loaded is valid)
          if (field === "scenePath") {
            if (existingMetadata[field] === undefined || existingMetadata[field] === null) {
              missingFields.push(field);
            }
          } else {
            // For other fields, empty strings are considered missing
            if (
              !existingMetadata[field] ||
              (typeof existingMetadata[field] === "string" && existingMetadata[field].trim() === "")
            ) {
              missingFields.push(field);
            }
          }
        }

        if (missingFields.length > 0) {
          // Metadata is incomplete - auto-complete it
          const config = vscode.workspace.getConfiguration("vizscript.metadata");
          const metadataEnabled = config.get<boolean>("enabled", true);
          const autoUpdate = config.get<boolean>("autoUpdate", false);

          if (!metadataEnabled) {
            // Metadata disabled, just continue with existing content
            return { content: originalContent };
          }

          if (autoUpdate || options.preview) {
            // Auto-complete missing fields
            const mergedMetadata = metadataService.mergeMetadata(existingMetadata, suggestedMetadata);
            const updateResult = await metadataService.updateMetadataInContent(originalContent, mergedMetadata);

            if (updateResult.success) {
              return {
                content: updateResult.content,
                message: options.preview
                  ? undefined
                  : `Metadata auto-completed for "${scriptObject.name}". Added: ${missingFields.join(", ")}`,
              };
            }
          } else {
            // Show prompt for incomplete metadata
            const choice = await vscode.window.showInformationMessage(
              `Metadata is incomplete for "${scriptObject.name}". Missing: ${missingFields.join(", ")}`,
              "Auto-complete",
              "Continue anyway",
            );

            if (choice === "Auto-complete") {
              const mergedMetadata = metadataService.mergeMetadata(existingMetadata, suggestedMetadata);
              const updateResult = await metadataService.updateMetadataInContent(originalContent, mergedMetadata);

              if (updateResult.success) {
                return {
                  content: updateResult.content,
                  message: `Metadata auto-completed for "${scriptObject.name}". Added: ${missingFields.join(", ")}`,
                };
              }
            } else if (choice === undefined) {
              throw new Error("Script opening cancelled due to incomplete metadata");
            }
            // If "Continue anyway", fall through to return original content
          }
        } else {
          // Metadata is complete - check if user wants to update with current script info
          // Only prompt if there are meaningful differences and not in preview mode
          // Skip prompts for collections (groups) as they're virtual groupings
          if (shouldPromptForMetadataUpdate(existingMetadata, suggestedMetadata) && !options.preview && !scriptObject.isGroup) {
            // Create suggested metadata that preserves existing UUID and other important fields
            const properSuggestedMetadata = metadataService.mergeMetadata(existingMetadata, suggestedMetadata);

            const dialogOptions: MetadataDialogOptions = {
              currentMetadata: existingMetadata,
              suggestedMetadata: properSuggestedMetadata,
              scriptName: scriptObject.name,
            };

            const dialogResult = await showMetadataUpdateDialog(dialogOptions);

            if (dialogResult.action === "update" && dialogResult.metadata) {
              const updateResult = await metadataService.updateMetadataInContent(
                originalContent,
                dialogResult.metadata,
              );
              if (updateResult.success) {
                return {
                  content: updateResult.content, // Use the updated content
                  message: `Metadata updated for "${scriptObject.name}"`,
                };
              }
            } else if (dialogResult.action === "setFilePath" && dialogResult.metadata) {
              // Handle filePath setting
              const fileService = new FileService();
              const suggestedPath = fileService.generateSuggestedFilePath(
                scriptObject.name,
                scriptObject.type,
                existingMetadata.scenePath || "",
              );

              const newFilePath = await showFilePathDialog(
                existingMetadata.filePath || "",
                scriptObject.name,
                suggestedPath,
              );

              if (newFilePath) {
                // Update metadata with new filePath
                const updatedMetadata = { ...existingMetadata, filePath: newFilePath };
                const updateResult = await metadataService.updateMetadataInContent(originalContent, updatedMetadata);
                if (updateResult.success) {
                  return {
                    content: updateResult.content,
                    message: `File path set to "${newFilePath}" for "${scriptObject.name}"`,
                  };
                }
              }
            }
          }
        }
      } catch (error) {
        console.error("Error processing metadata:", error);
      }

      return { content: originalContent };
    }
  } catch (error) {
    console.error("Error in processScriptWithMetadata:", error);
    return { content: scriptObject.code };
  }
}

/**
 * Helper function to detect metadata in content lines
 */
function detectMetadataInLines(lines: string[]): boolean {
  let hasStart = false;
  let hasEnd = false;

  for (const line of lines) {
    if (line.includes("VSCODE-META-START")) {
      hasStart = true;
    }
    if (line.includes("VSCODE-META-END")) {
      hasEnd = true;
    }
    if (hasStart && hasEnd) {
      return true;
    }
  }

  return hasStart && hasEnd;
}

/**
 * Determines if we should prompt user for metadata update
 */
function shouldPromptForMetadataUpdate(current: any, suggested: any): boolean {
  if (!current || !suggested) return false;

  // Check for meaningful differences (ignore UUID and minor fields)
  // UUID should never be changed, so we don't consider it for update prompts
  const importantFields = ["scenePath", "scriptType", "fileName", "vizVersion"];

  for (const field of importantFields) {
    if (current[field] !== suggested[field]) {
      return true;
    }
  }

  return false;
}

/**
 * Validates and handles metadata for script setting
 */
async function validateAndHandleMetadataForScriptSetting(
  content: string,
  client: LanguageClient,
  hostName: string,
  hostPort: number,
  selectedLayer: string,
  vizId: string,
  context: ExtensionContext,
): Promise<void> {
  const metadataService = new MetadataService(client);
  const sceneService = new SceneService();
  const lines = content.split(/\r?\n/g);
  const hasMetadata = detectMetadataInLines(lines);

  if (hasMetadata) {
    // Extract and validate existing metadata
    try {
      const metadataResult = await metadataService.extractMetadataFromContent(content);
      if (metadataResult.success && metadataResult.metadata) {
        const metadata = metadataResult.metadata;
        let needsUpdate = false;
        let updatedMetadata = { ...metadata };

        // Get script objects to find current script info for completing missing fields
        const scriptObjects = await loadFromStorage(context);
        const currentScript = scriptObjects.find((s) => s.vizId === vizId);

        // Determine script type first to know which fields are required
        let scriptType = updatedMetadata.scriptType;
        if (!scriptType) {
          const languageId = vscode.window.activeTextEditor?.document.languageId;
          if (languageId === "viz" || languageId === "viz4" || languageId === "viz5") {
            scriptType = "Scene";
          } else if (languageId === "viz-con" || languageId === "viz4-con" || languageId === "viz5-con") {
            scriptType = "Container";
          } else {
            scriptType = currentScript?.type || "Scene";
          }
          updatedMetadata.scriptType = scriptType;
        }

        // Check and add missing required fields
        const requiredFields = ["UUID", "scriptType", "fileName"];
        // scenePath is only required for Scene scripts
        if (scriptType === "Scene") {
          requiredFields.push("scenePath");
        }

        const missingFields: string[] = [];

        for (const field of requiredFields) {
          if (
            !updatedMetadata[field] ||
            (typeof updatedMetadata[field] === "string" && updatedMetadata[field].trim() === "")
          ) {
            missingFields.push(field);
            needsUpdate = true;

            // Auto-complete missing fields based on current script info
            switch (field) {
              case "scenePath":
                updatedMetadata.scenePath = currentScript?.scenePath || "";
                break;
              case "UUID":
                // Use deterministic UUID if vizId is available, otherwise generate random
                updatedMetadata.UUID = currentScript?.vizId
                  ? metadataService.generateDeterministicUUID(currentScript.vizId)
                  : metadataService.generateUUID();
                break;
              case "scriptType":
                updatedMetadata.scriptType = scriptType;
                break;
              case "fileName":
                updatedMetadata.fileName = currentScript?.name || "untitled";
                break;
            }
          }
        }

        // Update metadata if any fields were added
        if (needsUpdate) {
          // Sort the metadata to ensure consistent field order
          updatedMetadata = metadataService.mergeMetadata({}, updatedMetadata);

          console.log(`Auto-completing missing metadata fields: ${missingFields.join(", ")}`);

          const updateResult = await metadataService.updateMetadataInContent(content, updatedMetadata);
          if (updateResult.success) {
            // Apply updated content to the active document
            const editor = vscode.window.activeTextEditor;
            if (editor) {
              const edit = new vscode.WorkspaceEdit();
              const fullRange = new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(content.length),
              );
              edit.replace(editor.document.uri, fullRange, updateResult.content);
              await vscode.workspace.applyEdit(edit);
            }
          }
        }

        // Validate scene path if present
        if (updatedMetadata.scenePath) {
          const sceneValidation = await sceneService.validateScenePath(
            updatedMetadata.scenePath,
            hostName,
            hostPort,
            selectedLayer,
          );

          if (!sceneValidation.isValid) {
            const choice = await vscode.window.showWarningMessage(
              `Scene path mismatch detected!`,
              {
                modal: true,
                detail: sceneValidation.error || "Unknown scene validation error",
              },
              { title: "Continue Anyway" },
              { title: "Update Metadata" },
              { title: "Cancel", isCloseAffordance: true },
            );

            if (choice?.title === "Cancel" || !choice) {
              throw new Error("Script setting cancelled due to scene path mismatch");
            } else if (choice?.title === "Update Metadata") {
              // Update metadata with current scene path
              updatedMetadata.scenePath = sceneValidation.currentScenePath || "";

              // Sort the metadata to ensure consistent field order
              updatedMetadata = metadataService.mergeMetadata({}, updatedMetadata);

              const updateResult = await metadataService.updateMetadataInContent(content, updatedMetadata);
              if (updateResult.success) {
                // Apply updated content to the active document
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                  const edit = new vscode.WorkspaceEdit();
                  const fullRange = new vscode.Range(
                    editor.document.positionAt(0),
                    editor.document.positionAt(content.length),
                  );
                  edit.replace(editor.document.uri, fullRange, updateResult.content);
                  await vscode.workspace.applyEdit(edit);
                }
              }
            }
            // If "Continue Anyway" was selected, don't update metadata
          }
        }

        // Note: We no longer store vizId in metadata since it changes frequently
        // UUID is the stable identifier used for script resolution
      }
    } catch (error) {
      console.error("Error validating metadata:", error);
    }
  } else {
    // No metadata found - offer to create it
    const shouldCreateMetadata = await vscode.window.showInformationMessage(
      "No metadata found in this script. Create metadata automatically?",
      {
        modal: false,
        detail: "Metadata helps track script relationships with Viz scenes and enables better version control.",
      },
      { title: "Create Metadata" },
      { title: "Skip", isCloseAffordance: true },
    );

    if (shouldCreateMetadata?.title === "Create Metadata") {
      try {
        // Get script objects to find the current one
        const scriptObjects = await loadFromStorage(context);
        const currentScript = scriptObjects.find((s) => s.vizId === vizId);

        if (currentScript) {
          const injectionResult = await metadataService.injectMetadataIntoContent(content, currentScript, "local");
          if (injectionResult.success) {
            // Apply updated content to the active document
            const editor = vscode.window.activeTextEditor;
            if (editor) {
              const edit = new vscode.WorkspaceEdit();
              const fullRange = new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(content.length),
              );
              edit.replace(editor.document.uri, fullRange, injectionResult.content);
              await vscode.workspace.applyEdit(edit);

              vscode.window.showInformationMessage("Metadata created successfully!");
            }
          }
        }
      } catch (error) {
        console.error("Error creating metadata:", error);
        vscode.window.showWarningMessage("Failed to create metadata automatically.");
      }
    }
  }
}

export async function openScriptInDiff(context: ExtensionContext, vizId: string) {
  const state = await loadFromStorage(context);
  const scriptObjects: VizScriptObject[] = state;
  if (!scriptObjects) {
    throw new Error("No script objects found.");
  }
  const scriptObject = scriptObjects.find((element) => element.vizId === vizId);
  if (!scriptObject) {
    throw new Error("No script object found.");
  }

  const vizIdStripped = vizId.replace("#", "");

  await diffWithActiveEditor(vizIdStripped, scriptObject.name, scriptObject.extension, scriptObject.code, context);
}

export async function showVizScriptQuickPick(connectionInfo: VizScriptCompilerSettings, context: ExtensionContext) {
  window.setStatusBarMessage("Getting viz scripts...", 5000);

  try {
    //TODO: Hardcoded layer MAIN_SCENE for now
    const reply = await getVizScripts(connectionInfo.hostName, Number(connectionInfo.hostPort), context, "MAIN_SCENE");

    let elements = reply.map((element: VizScriptObject) => {
      return {
        description: `${element.type} ${element.name}`,
        label: element.vizId,
        detail: element.code.slice(0, 100),
      };
    });

    return window.showQuickPick(elements, {
      matchOnDescription: true,
      matchOnDetail: false,
      placeHolder: "Select your script",
    });
  } catch (error) {
    showMessage(error);
  }
}

let compileMessage: StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 0);

export async function compileCurrentScript(
  context: ExtensionContext,
  client: LanguageClient,
  config?: {
    vizId?: string;
    hostname?: string;
    port?: number;
    selectedLayer?: string;
    scriptCount?: number;
    currentIndex?: number;
  },
) {
  try {
    const connectionInfo = await getConfig();
    const hostName = config?.hostname || connectionInfo.hostName;
    const hostPort = config?.port || connectionInfo.hostPort;
    const selectedLayer = config?.selectedLayer || "MAIN_SCENE";

    // Refetch scene information to ensure we have current scene data
    await refetchSceneData(context, hostName, hostPort, selectedLayer);

    if (!window.activeTextEditor) {
      throw new Error("No active text editor.");
    }

    const document = window.activeTextEditor.document;
    const content = document.getText();

    // Extract metadata from current script to resolve vizId
    const metadataService = new MetadataService(client);
    const metadataResult = await metadataService.extractMetadataFromContent(content);

    let vizId = config?.vizId;

    if (metadataResult.success && metadataResult.metadata) {
      // Resolve UUID to current vizId if UUID exists
      const resolvedVizId = await resolveScriptVizIdByUUID(
        metadataResult.metadata,
        hostName,
        hostPort,
        selectedLayer,
        context,
        client,
      );

      if (resolvedVizId) {
        vizId = resolvedVizId;
      }
    }

    if (!vizId) {
      throw new Error(
        "No viz script associated with this script. Please add metadata with UUID or select a script from the sidebar first.",
      );
    }

    // Enhanced validation and metadata handling
    await validateAndHandleMetadataForScriptSetting(content, client, hostName, hostPort, selectedLayer, vizId, context);

    // Get the updated content after metadata processing
    const updatedContent = window.activeTextEditor?.document.getText() || content;

    try {
      await syntaxCheckCurrentScript(context, client, selectedLayer);
    } catch (error) {
      throw new Error("Syntax error in script. Please correct before trying to set again.");
    }

    await compileScriptId(context, updatedContent, hostName, hostPort, vizId, selectedLayer);

    // Create success message with count if multiple scripts are being set
    let successMessage = "Script set successfully in Viz!";
    if (config?.scriptCount && config.scriptCount > 1) {
      const currentIndex = config.currentIndex || 1;
      successMessage = `Script ${currentIndex} of ${config.scriptCount} set successfully in Viz!`;
    }

    window.showInformationMessage(successMessage);
  } catch (error) {
    showMessage(error);
  }
}

/**
 * Set script in main layer (MAIN_SCENE)
 */
export async function setScriptInMainLayer(context: ExtensionContext, client: LanguageClient) {
  await compileCurrentScript(context, client, { selectedLayer: "MAIN_SCENE" });
}

/**
 * Set script in front layer (FRONT_LAYER)
 */
export async function setScriptInFrontLayer(context: ExtensionContext, client: LanguageClient) {
  await compileCurrentScript(context, client, { selectedLayer: "FRONT_LAYER" });
}

/**
 * Set script in back layer (BACK_LAYER)
 */
export async function setScriptInBackLayer(context: ExtensionContext, client: LanguageClient) {
  await compileCurrentScript(context, client, { selectedLayer: "BACK_LAYER" });
}

/**
 * Refetch scene data to ensure current scene information is available
 */
async function refetchSceneData(
  context: ExtensionContext,
  hostName: string,
  hostPort: number,
  selectedLayer: string,
): Promise<void> {
  try {
    // Fetch current scene information from Viz to update scene path
    await getVizScripts(hostName, hostPort, context, selectedLayer);
    console.log("Scene data refetched successfully");
  } catch (error) {
    console.warn("Failed to refetch scene data:", error);
    // Don't throw here - let the script setting continue with cached data
  }
}

export async function resetScripts(context: ExtensionContext, client: LanguageClient) {
  await saveToStorage(context, []);
}

export async function syntaxCheckCurrentScript(
  context: ExtensionContext,
  client: LanguageClient,
  selectedLayer: string,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const connectionString = await getConfig();
      if (!window.activeTextEditor) {
        throw new Error("No active text editor.");
      }
      const scriptType = window.activeTextEditor.document.languageId === "viz" ? "Scene" : "Container";
      const message = await compileScript(
        window.activeTextEditor.document.getText(),
        connectionString.hostName,
        connectionString.hostPort,
        scriptType,
      );

      const [error, rangeString]: [string, string] = await client.sendRequest("showDiagnostics", message);

      if (error === "OK") {
        compileMessage.text = "$(check) Compile OK";
        compileMessage.backgroundColor = new ThemeColor("statusBarItem.successBackground");
        showStatusMessage(compileMessage);
        resolve();
      } else {
        const [line, char] = rangeString.split("/").map(Number);
        const range = new Range(line - 1, 0, line - 1, char);
        const editor = window.activeTextEditor;
        editor.selection = new Selection(range.start, range.end);
        editor.revealRange(range);

        compileMessage.text = "$(error) " + error;
        compileMessage.backgroundColor = new ThemeColor("statusBarItem.errorBackground");
        showStatusMessage(compileMessage);
        reject(new Error(error));
      }
    } catch (error) {
      showMessage(error);
      reject(error);
    }
  });
}

async function showStatusMessage(currentErrorMessage: StatusBarItem) {
  currentErrorMessage.show();
  await delay(10000);
  currentErrorMessage.hide();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class VizScriptCompilerSettings {
  hostName: string;
  hostPort: number;
}

function getConnectionSettings(): Promise<VizScriptCompilerSettings> {
  let config = workspace.getConfiguration("vizscript.compiler");
  let result = new VizScriptCompilerSettings();
  result.hostName = config.get("hostName") || "localhost";
  result.hostPort = config.get("hostPort") || 6100;
  return Promise.resolve(result);
}

export async function getConfig(): Promise<VizScriptCompilerSettings> {
  return await getConnectionSettings();
}

/**
 * Splits a script group into individual scripts
 */
export async function splitScriptGroup(context: ExtensionContext, groupVizId: string): Promise<void> {
  try {
    const scriptObjects = await loadFromStorage(context);
    const groupIndex = scriptObjects.findIndex((script) => script.vizId === groupVizId);

    if (groupIndex === -1) {
      throw new Error("Group not found");
    }

    const group = scriptObjects[groupIndex];

    if (!group.isGroup || !group.children || group.children.length === 0) {
      throw new Error("Selected item is not a group or has no children");
    }

    // Create individual scripts from the group's children
    const individualScripts: VizScriptObject[] = [];

    for (let i = 0; i < group.children.length; i++) {
      const childVizId = group.children[i];

      const individualScript: VizScriptObject = {
        vizId: childVizId,
        type: "Container",
        extension: ".vsc",
        name: `${group.name}_${i + 1}`,
        code: group.code, // All children have the same code
        scenePath: group.scenePath,
        children: [],
        isGroup: false,
      };

      individualScripts.push(individualScript);
    }

    // Remove the group and add individual scripts
    scriptObjects.splice(groupIndex, 1, ...individualScripts);

    await saveToStorage(context, scriptObjects);

    // Refresh sidebar with current state (don't re-fetch from Viz to avoid auto-grouping)
    vscode.commands.executeCommand("vizscript.refreshsidebar");

    vscode.window.showInformationMessage(
      `Split group "${group.name}" into ${individualScripts.length} individual scripts`,
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to split group: ${error.message}`);
  }
}

/**
 * Analyzes differences between scripts to provide helpful info
 */
function analyzeDifferences(scripts: VizScriptObject[]): string[] {
  if (scripts.length < 2) return [];

  const baseScript = scripts[0];
  const results: string[] = [];

  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];

    if (i === 0) {
      results.push("Reference script");
      continue;
    }

    const baseLines = baseScript.code.split("\n");
    const currentLines = script.code.split("\n");

    // Basic difference analysis
    if (baseLines.length !== currentLines.length) {
      const diff = currentLines.length - baseLines.length;
      results.push(`${diff > 0 ? "+" : ""}${diff} lines difference`);
    } else {
      // Count different lines
      let differentLines = 0;
      for (let j = 0; j < baseLines.length; j++) {
        if (baseLines[j] !== currentLines[j]) {
          differentLines++;
        }
      }
      if (differentLines > 0) {
        results.push(`${differentLines} line${differentLines === 1 ? "" : "s"} modified`);
      } else {
        results.push("Identical content");
      }
    }
  }

  return results;
}

/**
 * Shows a diff dialog for merging scripts with different content
 */
async function showMergeDiffDialog(
  scripts: VizScriptObject[],
): Promise<{ selectedContent: string; cancelled: boolean }> {
  try {
    // Create temporary files for each script to show diffs
    const tempFiles: { uri: vscode.Uri; script: VizScriptObject }[] = [];

    for (let i = 0; i < scripts.length; i++) {
      const script = scripts[i];
      const tempUri = vscode.Uri.parse(`untitled:${script.name}_merge_${i}.${script.extension.substring(1)}`);
      const doc = await vscode.workspace.openTextDocument(tempUri);

      // Insert content into the document
      const edit = new vscode.WorkspaceEdit();
      edit.insert(tempUri, new vscode.Position(0, 0), script.code);
      await vscode.workspace.applyEdit(edit);

      tempFiles.push({ uri: tempUri, script });
    }

    // Analyze differences between scripts
    const differences = analyzeDifferences(scripts);

    // Show quick pick to let user choose which version to use
    const items = scripts.map((script, index) => ({
      label: `$(file-code) ${script.name}`,
      description: script.vizId,
      detail: `Lines: ${script.code.split("\n").length}, Characters: ${script.code.length}${differences[index] ? ` • ${differences[index]}` : ""}`,
      script: script,
      index: index,
    }));

    // Add preview options
    const previewItems = scripts.map((script, index) => ({
      label: `$(eye) Preview ${script.name}`,
      description: "Open in editor to view full content",
      detail: `Preview the full content of ${script.name}`,
      script: script,
      index: index,
      isPreview: true,
    }));

    // Add option to show diff first
    const selectedItem = await vscode.window.showQuickPick(
      [
        {
          label: "$(diff) Compare Scripts",
          description: "Show differences between scripts",
          detail: "Open diff view to compare script contents",
          isCompareOption: true,
        },
        { label: "", kind: vscode.QuickPickItemKind.Separator },
        { label: "Preview Scripts", kind: vscode.QuickPickItemKind.Separator },
        ...previewItems,
        { label: "", kind: vscode.QuickPickItemKind.Separator },
        { label: "Choose Version to Keep", kind: vscode.QuickPickItemKind.Separator },
        ...items,
      ],
      {
        placeHolder: "Scripts have different content. Compare, preview, or choose which version to keep:",
        ignoreFocusOut: true,
      },
    );

    if (!selectedItem) {
      return { selectedContent: "", cancelled: true };
    }

    // If user chose to preview a script
    if ((selectedItem as any).isPreview) {
      const scriptToPreview = (selectedItem as any).script;
      const previewUri = tempFiles.find((tf) => tf.script.vizId === scriptToPreview.vizId)?.uri;

      if (previewUri) {
        await vscode.window.showTextDocument(previewUri, { preview: true });

        // Show the picker again after preview
        const afterPreviewChoice = await vscode.window.showQuickPick(items, {
          placeHolder: "After reviewing the preview, choose which version to keep:",
          ignoreFocusOut: true,
        });

        if (!afterPreviewChoice) {
          return { selectedContent: "", cancelled: true };
        }

        return { selectedContent: (afterPreviewChoice as any).script.code, cancelled: false };
      }
    }

    // If user chose to compare first
    if ((selectedItem as any).isCompareOption) {
      if (tempFiles.length >= 2) {
        // If only 2 scripts, show direct diff
        if (tempFiles.length === 2) {
          await vscode.commands.executeCommand(
            "vscode.diff",
            tempFiles[0].uri,
            tempFiles[1].uri,
            `Compare: ${tempFiles[0].script.name} ↔ ${tempFiles[1].script.name}`,
          );
        } else {
          // If more than 2 scripts, let user choose which two to compare
          const compareItems = [];
          for (let i = 0; i < tempFiles.length; i++) {
            for (let j = i + 1; j < tempFiles.length; j++) {
              compareItems.push({
                label: `$(diff) ${tempFiles[i].script.name} ↔ ${tempFiles[j].script.name}`,
                detail: `Compare ${tempFiles[i].script.name} with ${tempFiles[j].script.name}`,
                leftIndex: i,
                rightIndex: j,
              });
            }
          }

          const compareChoice = await vscode.window.showQuickPick(compareItems, {
            placeHolder: "Choose which scripts to compare:",
            ignoreFocusOut: true,
          });

          if (compareChoice) {
            await vscode.commands.executeCommand(
              "vscode.diff",
              tempFiles[compareChoice.leftIndex].uri,
              tempFiles[compareChoice.rightIndex].uri,
              `Compare: ${tempFiles[compareChoice.leftIndex].script.name} ↔ ${tempFiles[compareChoice.rightIndex].script.name}`,
            );
          }
        }

        // Show the picker again after diff
        const secondChoice = await vscode.window.showQuickPick(items, {
          placeHolder: "After reviewing the diff, choose which version to keep:",
          ignoreFocusOut: true,
        });

        if (!secondChoice) {
          return { selectedContent: "", cancelled: true };
        }

        return { selectedContent: (secondChoice as any).script.code, cancelled: false };
      }
    }

    return { selectedContent: (selectedItem as any).script.code, cancelled: false };
  } catch (error) {
    vscode.window.showErrorMessage(`Error showing merge diff: ${error.message}`);
    return { selectedContent: "", cancelled: true };
  } finally {
    // Close any temporary untitled documents that were created
    const openDocuments = vscode.workspace.textDocuments;
    for (const doc of openDocuments) {
      if (doc.uri.scheme === "untitled" && doc.uri.path.includes("_merge_")) {
        try {
          // Close the document without saving
          await vscode.window.showTextDocument(doc);
          await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        } catch (closeError) {
          // Ignore errors when closing documents
        }
      }
    }
  }
}

/**
 * Merges selected individual scripts into a group
 */
export async function mergeScriptsIntoGroup(context: ExtensionContext, vizIds: string[]): Promise<void> {
  try {
    if (vizIds.length < 2) {
      throw new Error("At least 2 scripts must be selected to create a group");
    }

    const scriptObjects = await loadFromStorage(context);
    const scriptsToMerge: VizScriptObject[] = [];
    const indicesToRemove: number[] = [];

    // Find all scripts to merge and collect their data
    for (const vizId of vizIds) {
      const index = scriptObjects.findIndex((script) => script.vizId === vizId);
      if (index !== -1) {
        const script = scriptObjects[index];

        // Only allow merging of container scripts with same content
        if (script.type !== "Container" || script.isGroup) {
          throw new Error("Can only merge individual container scripts");
        }

        scriptsToMerge.push(script);
        indicesToRemove.push(index);
      }
    }

    if (scriptsToMerge.length < 2) {
      throw new Error("Not enough valid scripts found to merge");
    }

    // Verify all scripts have the same content
    const firstScript = scriptsToMerge[0];
    const allSameContent = scriptsToMerge.every((script) => script.code === firstScript.code);

    let selectedContent = firstScript.code;

    if (!allSameContent) {
      // Show diff and let user choose which version to keep
      const result = await showMergeDiffDialog(scriptsToMerge);
      if (result.cancelled) {
        return;
      }
      selectedContent = result.selectedContent;
    }

    // Create the new group
    const collectionIndex = scriptObjects.filter((s) => s.isGroup).length;

    const groupScript: VizScriptObject = {
      vizId: `#c${collectionIndex}`,
      type: `ContainerCollection ( x${scriptsToMerge.length} )`,
      extension: ".vsc",
      name: `Collection${collectionIndex}`,
      code: selectedContent,
      scenePath: firstScript.scenePath,
      children: scriptsToMerge.map((script) => script.vizId),
      isGroup: true,
    };

    // Remove individual scripts (in reverse order to maintain indices)
    indicesToRemove.sort((a, b) => b - a);
    for (const index of indicesToRemove) {
      scriptObjects.splice(index, 1);
    }

    // Add the new group
    scriptObjects.push(groupScript);

    await saveToStorage(context, scriptObjects);

    // Refresh sidebar with current state
    vscode.commands.executeCommand("vizscript.refreshsidebar");

    vscode.window.showInformationMessage(`Merged ${scriptsToMerge.length} scripts into group "${groupScript.name}"`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to merge scripts: ${error.message}`);
  }
}

/**
 * Renames a collection and updates its metadata
 */
export async function renameCollection(context: ExtensionContext, client: LanguageClient, vizId: string): Promise<void> {
  try {
    const scriptObjects = await loadFromStorage(context);
    const collectionIndex = scriptObjects.findIndex((script) => script.vizId === vizId && script.isGroup);

    if (collectionIndex === -1) {
      throw new Error("Collection not found");
    }

    const collection = scriptObjects[collectionIndex];
    const oldName = collection.name; // Save old name for matching in open documents
    
    // Prompt user for new name
    const newName = await vscode.window.showInputBox({
      prompt: "Enter new collection name",
      value: collection.name,
      validateInput: (value: string) => {
        if (!value || value.trim().length === 0) {
          return "Collection name cannot be empty";
        }
        return null;
      }
    });

    if (!newName || newName === collection.name) {
      // User cancelled or didn't change the name
      return;
    }

    console.log(`[renameCollection] Updating collection ${vizId} name from "${oldName}" to "${newName.trim()}"`);

    // Update collection name
    collection.name = newName.trim();
    
    // Save updated collection to storage
    scriptObjects[collectionIndex] = collection;
    await saveToStorage(context, scriptObjects);
    
    console.log(`[renameCollection] Saved to storage. Verifying...`);
    const verifyScripts = await loadFromStorage(context);
    const verifyCollection = verifyScripts.find(s => s.vizId === vizId);
    console.log(`[renameCollection] Verified collection name in storage:`, verifyCollection?.name);

    // Find any open editors with this collection and update their metadata
    const openDocuments = vscode.workspace.textDocuments;
    for (const doc of openDocuments) {
      // Check if this document contains our collection
      const content = doc.getText();
      
      // Look for metadata with matching UUID or vizId
      const lines = content.split(/\r?\n/g);
      let inMetaSection = false;
      let metadataJson = "";
      
      for (const line of lines) {
        if (line.includes("VSCODE-META-START") && line.includes("VSCODE-META-END")) {
          // Single-line format
          const startIndex = line.indexOf("VSCODE-META-START") + "VSCODE-META-START".length;
          const endIndex = line.indexOf("VSCODE-META-END");
          if (startIndex < endIndex) {
            metadataJson = line.substring(startIndex, endIndex);
          }
          break;
        } else if (line.includes("VSCODE-META-START")) {
          inMetaSection = true;
          continue;
        } else if (line.includes("VSCODE-META-END")) {
          break;
        } else if (inMetaSection) {
          const cleanLine = line.startsWith("'") ? line.substring(1) : line;
          metadataJson += cleanLine + "\n";
        }
      }

      if (metadataJson) {
        try {
          const metadata = JSON.parse(metadataJson);
          
          // Check if this metadata belongs to our collection
          // Use oldName for matching since collection.name has already been updated
          if (metadata.isGroup && (
            (metadata.UUID && metadata.UUID === uuidByString(`vizscript-${vizId}`)) ||
            (metadata.scenePath === collection.scenePath && metadata.fileName === oldName)
          )) {
            // Update the metadata with new name
            metadata.fileName = newName.trim();
            
            // Update the document
            const metadataService = new MetadataService(client);
            const result = await metadataService.updateMetadataInContent(content, metadata);
            
            if (result.success) {
              const edit = new vscode.WorkspaceEdit();
              const fullRange = new vscode.Range(
                doc.positionAt(0),
                doc.positionAt(content.length)
              );
              edit.replace(doc.uri, fullRange, result.content);
              await vscode.workspace.applyEdit(edit);
            }
          }
        } catch (parseError) {
          // Ignore parsing errors for non-matching documents
        }
      }
    }

    // Refresh sidebar to show updated name
    vscode.commands.executeCommand("vizscript.refreshsidebar");

    vscode.window.showInformationMessage(`Collection renamed to "${newName}"`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to rename collection: ${error.message}`);
  }
}


/**
 * Refreshes the sidebar with current stored scripts without re-fetching from Viz
 */
export async function refreshSidebar(context: ExtensionContext, sidebarProvider: SidebarProvider): Promise<void> {
  try {
    const scriptObjects = await loadFromStorage(context);

    // Send current scripts to sidebar
    if (sidebarProvider._view?.webview) {
      sidebarProvider._view.webview.postMessage({ type: "receiveScripts", value: scriptObjects || [] });
    }
  } catch (error) {
    console.error("Error refreshing sidebar:", error);
  }
}

/**
 * Resolves script vizId by matching UUID from metadata with current scripts in Viz
 */
async function resolveScriptVizIdByUUID(
  metadata: any,
  hostName: string,
  hostPort: number,
  selectedLayer: string,
  context: ExtensionContext,
  client: LanguageClient,
): Promise<string | null> {
  if (!metadata.UUID) {
    return null; // No UUID to match against
  }

  try {
    // Fetch current scripts from Viz
    const currentScripts = await getVizScripts(hostName, hostPort, context, selectedLayer);

    // Find script with matching UUID
    const metadataService = new MetadataService(client);
    let matchingScript: VizScriptObject | undefined;

    for (const script of currentScripts) {
      // Check if script has metadata with matching UUID
      const scriptMetadata = await metadataService.extractMetadataFromContent(script.code);
      if (scriptMetadata.success && scriptMetadata.metadata && scriptMetadata.metadata.UUID === metadata.UUID) {
        matchingScript = script;
        break;
      }
    }

    if (matchingScript) {
      console.log(`Resolved script UUID ${metadata.UUID} to current vizId: ${matchingScript.vizId}`);
      return matchingScript.vizId;
    }

    return null;
  } catch (error) {
    console.warn("Failed to resolve script by UUID:", error);
    return null;
  }
}

/**
 * Shows a quick pick to select scripts for merging
 */
export async function showMergeScriptsQuickPick(context: ExtensionContext): Promise<void> {
  try {
    const scriptObjects = await loadFromStorage(context);
    const containerScripts = scriptObjects.filter((script) => script.type === "Container" && !script.isGroup);

    if (containerScripts.length < 2) {
      vscode.window.showWarningMessage("Need at least 2 individual container scripts to create a group");
      return;
    }

    const items = containerScripts.map((script) => ({
      label: script.name,
      description: script.vizId,
      detail: script.code.substring(0, 100) + (script.code.length > 100 ? "..." : ""),
      script: script,
    }));

    const selectedItems = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: "Select scripts to merge into a group",
    });

    if (selectedItems && selectedItems.length >= 2) {
      const vizIds = selectedItems.map((item) => item.script.vizId);
      await mergeScriptsIntoGroup(context, vizIds);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to show merge selection: ${error.message}`);
  }
}

/**
 * Gets script parameters and sends them to the secondary sidebar
 */
export async function getScriptParameters(
  context: ExtensionContext,
  data: { scriptId: string; hostname: string; port: number },
  sidebarProvider: SidebarProvider,
): Promise<void> {
  try {
    console.log("getScriptParameters called with data:", data);
    const { scriptId, hostname, port } = data;

    if (!scriptId) {
      throw new Error("No script ID provided");
    }

    console.log("Calling getScriptParametersData...");
    const parametersData = await getScriptParametersData(hostname, port, scriptId);
    console.log("Received parameters data:", parametersData);

    // Send parameters to secondary sidebar
    if (sidebarProvider._view?.webview) {
      console.log("Sending parameters to webview...");
      sidebarProvider._view.webview.postMessage({
        type: "receiveScriptParameters",
        value: parametersData,
      });
    } else {
      console.log("No webview available to send parameters to");
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to get script parameters: ${error.message}`);
    console.error("Error getting script parameters:", error);

    // Send error state to webview
    if (sidebarProvider._view?.webview) {
      sidebarProvider._view.webview.postMessage({
        type: "receiveScriptParameters",
        value: null,
      });
    }
  }
}

/**
 * Sets a script parameter value and refreshes the parameters
 */
export async function setScriptParameter(
  context: ExtensionContext,
  data: { scriptId: string; parameterName: string; value: any; hostname: string; port: number },
  sidebarProvider: SidebarProvider,
): Promise<void> {
  try {
    const { scriptId, parameterName, value, hostname, port } = data;

    if (!scriptId || !parameterName) {
      throw new Error("Script ID and parameter name are required");
    }

    await setScriptParameterValue(hostname, port, scriptId, parameterName, value);

    // Refresh parameters to show updated values
    await getScriptParameters(context, { scriptId, hostname, port }, sidebarProvider);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to set script parameter: ${error.message}`);
    console.error("Error setting script parameter:", error);
  }
}

/**
 * Invokes a script parameter (for pushbuttons) and refreshes the parameters
 */
export async function invokeScriptParameter(
  context: ExtensionContext,
  data: { scriptId: string; parameterName: string; hostname: string; port: number },
  sidebarProvider: SidebarProvider,
): Promise<void> {
  try {
    const { scriptId, parameterName, hostname, port } = data;

    if (!scriptId || !parameterName) {
      throw new Error("Script ID and parameter name are required");
    }

    await invokeParameterService(hostname, port, scriptId, parameterName);

    // Refresh parameters to show any updated values
    await getScriptParameters(context, { scriptId, hostname, port }, sidebarProvider);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to invoke script parameter: ${error.message}`);
    console.error("Error invoking script parameter:", error);
  }
}
