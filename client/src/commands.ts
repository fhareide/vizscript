import { PreviewFileSystemProvider } from "./previewFileSystemProvider";
import { SidebarProvider } from "./sidebarProvider";
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from "vscode";
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
import { TreeService } from "./treeService";
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

    let options: QuickPickItem[] = [];
    let currentFileItem: QuickPickItem = {
      description: "",
      label: "Add script to current file",
      detail: "",
    };
    let newFileItem: QuickPickItem = {
      description: "",
      label: "Open script in new file",
      detail: "",
    };

    if (window.activeTextEditor == undefined) {
      options = [newFileItem];
    } else {
      options = [newFileItem, currentFileItem];
    }

    const selection = await window.showQuickPick(options, {
      matchOnDescription: true,
      matchOnDetail: false,
      placeHolder: "Select option",
    });

    if (!selection) {
      throw new Error("No selection made.");
    }

    let vizId = (<QuickPickItem>selectedScript).label;
    const openInNewFile = selection.label === "Open script in new file";

    await openScriptInTextEditor(context, client, vizId, openInNewFile);
  } catch (error) {
    showMessage(error);
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

          // First, try to resolve stored scripts with current tree structure
          progress.report({ increment: 10, message: "Resolving existing scripts..." });
          const storedScripts = await loadFromStorage(context);
          if (storedScripts && storedScripts.length > 0) {
            try {
              const treeService = new TreeService();
              const resolvedScripts = await treeService.resolveVizIdsFromTreePaths(
                storedScripts,
                hostName,
                hostPort,
                selectedLayer,
              );

              // Update storage with resolved scripts
              await saveToStorage(context, resolvedScripts);
              progress.report({ increment: 20, message: "Scripts resolved from tree paths." });

              // Send resolved scripts to sidebar first for immediate display
              sidebarProvider._view?.webview.postMessage({ type: "receiveScripts", value: resolvedScripts });
            } catch (error) {
              console.warn("Failed to resolve scripts from tree paths:", error);
            }
          }

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
      const fileService = new FileService();
      await fileService.openFile(processedScript.localFileUri);
    } else {
      // Open as untitled or preview as usual
      if (preview) {
        await showPreviewWindow(
          vizIdStripped,
          scriptObject.name,
          scriptObject.extension,
          processedScript.content,
          context,
        );
      } else {
        await showUntitledWindow(
          vizIdStripped,
          scriptObject.name,
          scriptObject.extension,
          processedScript.content,
          context,
        );
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

  // First, check if the script has metadata with filePath
  const originalContent = scriptObject.code;
  const lines = originalContent.split(/\r?\n/g);
  const hasMetadata = detectMetadataInLines(lines);

  if (hasMetadata && !options.forceRemote) {
    try {
      // Extract metadata to check for filePath
      const metadataResult = await metadataService.injectMetadataIntoContent(originalContent, scriptObject);
      if (metadataResult.success && metadataResult.metadata && metadataResult.metadata.filePath) {
        const filePath = metadataResult.metadata.filePath;

        // Try to find the local file
        const searchResult = await fileService.findFileInWorkspace(filePath);

        if (searchResult.found && searchResult.uri) {
          // Compare content
          const diffResult = await fileService.compareFileContent(searchResult.uri, originalContent);

          if (!diffResult.isDifferent) {
            // Content is the same, open local file directly
            return {
              content: originalContent,
              message: `Opening local file: ${searchResult.relativePath}`,
              openLocalFile: true,
              localFileUri: searchResult.uri,
            };
          } else {
            // Content differs, ask user what to do
            const choice = await fileService.showFileDifferenceChoice(
              searchResult.relativePath || searchResult.uri.fsPath,
              scriptObject.name,
            );

            switch (choice) {
              case "openLocal":
                return {
                  content: diffResult.localContent || originalContent,
                  message: `Opening local file: ${searchResult.relativePath}`,
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
                    message: `Opening local file: ${searchResult.relativePath}`,
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
      // No metadata found - only ask to add it if not in preview mode
      if (!options.preview) {
        const shouldInject = await showMetadataInjectionDialog(scriptObject.name);

        if (shouldInject) {
          try {
            const result = await metadataService.injectMetadataIntoContent(originalContent, scriptObject);
            if (result.success && result.wasInjected) {
              return {
                content: result.content, // Use the modified content with metadata
                message: `Metadata added to "${scriptObject.name}"`,
              };
            } else {
              console.warn("Failed to inject metadata:", result.error);
              return { content: originalContent };
            }
          } catch (error) {
            console.error("Error injecting metadata:", error);
            return { content: originalContent };
          }
        } else {
          return { content: originalContent };
        }
      } else {
        // In preview mode, just return the content without prompting
        return { content: originalContent };
      }
    } else {
      // Metadata exists - check if it needs validation/update
      try {
        const status = await metadataService.getMetadataStatus();

        if (!status.isValid && !options.preview) {
          // Invalid metadata - ask user how to handle (only if not in preview mode)
          const action = await showMetadataValidationErrors(status.errors, scriptObject.name);

          if (action === "fix") {
            const suggestedMetadata = metadataService.createDefaultMetadata(scriptObject);
            const mergedMetadata = metadataService.mergeMetadata(status.metadata || {}, suggestedMetadata);

            // First update the metadata in the content, then we can open it
            const fixResult = await metadataService.injectMetadataIntoContent(originalContent, scriptObject);
            if (fixResult.success) {
              return {
                content: fixResult.content, // Use the fixed content
                message: `Metadata fixed for "${scriptObject.name}"`,
              };
            }
          } else if (action === "cancel") {
            throw new Error("Script opening cancelled due to metadata issues");
          }
          // If "ignore", continue with existing content
        } else {
          // Valid metadata - check if user wants to update with current script info
          const currentMetadata = status.metadata;
          const suggestedMetadata = metadataService.createDefaultMetadata(scriptObject);

          // Only prompt if there are meaningful differences and not in preview mode
          if (shouldPromptForMetadataUpdate(currentMetadata, suggestedMetadata) && !options.preview) {
            const dialogOptions: MetadataDialogOptions = {
              currentMetadata,
              suggestedMetadata,
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
                currentMetadata.scenePath || "",
              );

              const newFilePath = await showFilePathDialog(
                currentMetadata.filePath || "",
                scriptObject.name,
                suggestedPath,
              );

              if (newFilePath) {
                // Update metadata with new filePath
                const updatedMetadata = { ...currentMetadata, filePath: newFilePath };
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

  // Check for meaningful differences (ignore lastModified and minor fields)
  const importantFields = ["scenePath", "vizId", "scriptType", "fileName"];

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
  const treeService = new TreeService();
  const lines = content.split(/\r?\n/g);
  const hasMetadata = detectMetadataInLines(lines);

  if (hasMetadata) {
    // Extract and validate existing metadata
    try {
      const metadataResult = await metadataService.extractMetadataFromContent(content);
      if (metadataResult.success && metadataResult.metadata) {
        const metadata = metadataResult.metadata;

        // Validate scene path if present
        if (metadata.scenePath) {
          const sceneValidation = await treeService.validateScenePath(
            metadata.scenePath,
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
              "Continue Anyway",
              "Update Metadata",
              "Cancel",
            );

            if (choice === "Cancel") {
              throw new Error("Script setting cancelled due to scene path mismatch");
            } else if (choice === "Update Metadata") {
              // Update metadata with current scene path
              metadata.scenePath = sceneValidation.currentScenePath || "";
              metadata.lastModified = new Date().toISOString();

              const updateResult = await metadataService.updateMetadataInContent(content, metadata);
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

        // Validate tree path for container scripts
        if (metadata.scriptType === "Container" && metadata.treePath) {
          const currentTreePath = await treeService.findTreePathForVizId(vizId, hostName, hostPort, selectedLayer);

          if (currentTreePath && currentTreePath !== metadata.treePath) {
            const choice = await vscode.window.showWarningMessage(
              `Tree path mismatch detected for container script!`,
              {
                modal: true,
                detail: `Expected tree path: ${metadata.treePath}\nCurrent tree path: ${currentTreePath}\n\nThis script may be targeting a different container location.`,
              },
              "Continue Anyway",
              "Update Tree Path",
              "Cancel",
            );

            if (choice === "Cancel") {
              throw new Error("Script setting cancelled due to tree path mismatch");
            } else if (choice === "Update Tree Path") {
              metadata.treePath = currentTreePath;
              metadata.lastModified = new Date().toISOString();

              const updateResult = await metadataService.updateMetadataInContent(content, metadata);
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

        // Update vizId and tree path if vizId changed
        if (metadata.vizId !== vizId) {
          metadata.vizId = vizId;
          metadata.lastModified = new Date().toISOString();

          // Only update treePath for container scripts
          if (metadata.scriptType === "Container") {
            const treePath = await treeService.findTreePathForVizId(vizId, hostName, hostPort, selectedLayer);
            if (treePath) {
              metadata.treePath = treePath;
            }
          }

          const updateResult = await metadataService.updateMetadataInContent(content, metadata);
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
      "Create Metadata",
      "Skip",
    );

    if (shouldCreateMetadata === "Create Metadata") {
      try {
        // Get script objects to find the current one
        const scriptObjects = await loadFromStorage(context);
        const currentScript = scriptObjects.find((s) => s.vizId === vizId);

        if (currentScript) {
          // Add tree path to the script object only for containers
          if (currentScript.type === "Container") {
            const treePath = await treeService.findTreePathForVizId(vizId, hostName, hostPort, selectedLayer);
            currentScript.treePath = treePath || "";
          }

          const injectionResult = await metadataService.injectMetadataIntoContent(content, currentScript);
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
  config: { vizId: string; hostname: string; port: number; selectedLayer: string },
) {
  try {
    const connectionInfo = await getConfig();
    const hostName = config.hostname || connectionInfo.hostName;
    const hostPort = config.port || connectionInfo.hostPort;
    const selectedLayer = config.selectedLayer || "MAIN_SCENE";
    const vizId = config.vizId;

    if (!window.activeTextEditor) {
      throw new Error("No active text editor.");
    }

    const document = window.activeTextEditor.document;
    const content = document.getText();

    // Enhanced validation and metadata handling
    await validateAndHandleMetadataForScriptSetting(content, client, hostName, hostPort, selectedLayer, vizId, context);

    try {
      await syntaxCheckCurrentScript(context, client, selectedLayer);
    } catch (error) {
      throw new Error("Syntax error in script. Please correct before trying to set again.");
    }

    await compileScriptId(context, content, hostName, hostPort, vizId, selectedLayer);
    window.showInformationMessage("Script set successfully in Viz!");
  } catch (error) {
    showMessage(error);
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
        compileMessage.backgroundColor = "";
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
      const treePath = Array.isArray(group.treePath) ? group.treePath[i] : "";

      const individualScript: VizScriptObject = {
        vizId: childVizId,
        type: "Container",
        extension: ".vsc",
        name: `${group.name}_${i + 1}`,
        code: group.code, // All children have the same code
        scenePath: group.scenePath,
        children: [],
        treePath: treePath,
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

    if (!allSameContent) {
      const shouldProceed = await vscode.window.showWarningMessage(
        "Selected scripts have different content. Merge anyway?",
        { modal: true },
        "Yes, Merge",
        "Cancel",
      );

      if (shouldProceed !== "Yes, Merge") {
        return;
      }
    }

    // Create the new group
    const collectionIndex = scriptObjects.filter((s) => s.isGroup).length;
    const treePaths = scriptsToMerge.map((script) => script.treePath as string).filter(Boolean);

    const groupScript: VizScriptObject = {
      vizId: `#c${collectionIndex}`,
      type: `ContainerCollection ( x${scriptsToMerge.length} )`,
      extension: ".vsc",
      name: `Collection${collectionIndex}`,
      code: firstScript.code,
      scenePath: firstScript.scenePath,
      children: scriptsToMerge.map((script) => script.vizId),
      treePath: treePaths,
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
