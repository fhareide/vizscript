/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import * as vscode from "vscode";
import * as Commands from "./commands";

import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import { PreviewContentProvider } from "./previewContentProvider";
import { SidebarProvider } from "./sidebarProvider";
import { VizScriptObject } from "./shared/types";
import { MetadataService } from "./metadataService";
import { FileService } from "./fileService";
import { randomUUID } from "crypto";

let client: LanguageClient;

// Helper functions for sidebar context menu commands
async function getSelectedScriptFromSidebar(sidebarProvider: SidebarProvider): Promise<string | null> {
  return new Promise((resolve) => {
    if (!sidebarProvider._view?.webview) {
      resolve(null);
      return;
    }

    const messageHandler = (message: any) => {
      if (message.type === "selectedScriptResponse") {
        sidebarProvider._view?.webview.onDidReceiveMessage(undefined);
        resolve(message.value?.vizId || null);
      }
    };

    sidebarProvider._view.webview.onDidReceiveMessage(messageHandler);
    sidebarProvider._view.webview.postMessage({ type: "getSelectedScript" });

    // Timeout after 1 second
    setTimeout(() => {
      sidebarProvider._view?.webview.onDidReceiveMessage(undefined);
      resolve(null);
    }, 1000);
  });
}

async function getSelectedScriptDataFromSidebar(sidebarProvider: SidebarProvider): Promise<any | null> {
  return new Promise((resolve) => {
    if (!sidebarProvider._view?.webview) {
      resolve(null);
      return;
    }

    const messageHandler = (message: any) => {
      if (message.type === "selectedScriptDataResponse") {
        sidebarProvider._view?.webview.onDidReceiveMessage(undefined);
        resolve(message.value || null);
      }
    };

    sidebarProvider._view.webview.onDidReceiveMessage(messageHandler);
    sidebarProvider._view.webview.postMessage({ type: "getSelectedScriptData" });

    // Timeout after 1 second
    setTimeout(() => {
      sidebarProvider._view?.webview.onDidReceiveMessage(undefined);
      resolve(null);
    }, 1000);
  });
}

async function getSelectedScriptNameFromSidebar(sidebarProvider: SidebarProvider): Promise<string | null> {
  return new Promise((resolve) => {
    if (!sidebarProvider._view?.webview) {
      resolve(null);
      return;
    }

    const messageHandler = (message: any) => {
      if (message.type === "selectedScriptResponse") {
        sidebarProvider._view?.webview.onDidReceiveMessage(undefined);
        resolve(message.value?.name || null);
      }
    };

    sidebarProvider._view.webview.onDidReceiveMessage(messageHandler);
    sidebarProvider._view.webview.postMessage({ type: "getSelectedScript" });

    // Timeout after 1 second
    setTimeout(() => {
      sidebarProvider._view?.webview.onDidReceiveMessage(undefined);
      resolve(null);
    }, 1000);
  });
}

function registerCommands(client: LanguageClient, context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      "vizscript.compile",
      Commands.syntaxCheckCurrentScript.bind(this, context, client),
    ),
    vscode.commands.registerTextEditorCommand(
      "vizscript.compile.currentscript",
      Commands.compileCurrentScript.bind(this, context, client),
    ),
  );
}

function registerNotifications(client: LanguageClient) {
  client.onNotification("requestCompile", () => vscode.commands.executeCommand("vizscript.compile"));
}

/**
 * Handles document save events to automatically update filePath in metadata
 */
async function handleDocumentSave(document: vscode.TextDocument, client: LanguageClient): Promise<void> {
  // Only process Viz script files
  const vizLanguages = ["viz", "viz-con", "viz4", "viz4-con", "viz5", "viz5-con"];
  if (!vizLanguages.includes(document.languageId)) {
    return;
  }

  // Skip untitled documents
  if (document.isUntitled) {
    return;
  }

  try {
    const fileService = new FileService();
    await fileService.updateFilePathInMetadata(document);
  } catch (error) {
    console.error("Error updating filePath in metadata:", error);
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
 * Detects the current format of metadata in the content
 */
function detectMetadataFormat(lines: string[]): "single-line" | "compact" | "traditional" {
  for (const line of lines) {
    if (line.includes("VSCODE-META-START") && line.includes("VSCODE-META-END")) {
      // Single-line format: 'VSCODE-META-START{json}VSCODE-META-END
      return "single-line";
    }
    if (line.includes("VSCODE-META-START") && !line.includes("VSCODE-META-END")) {
      // Multi-line format, need to check if compact or traditional
      let metadataLineCount = 0;
      let foundEnd = false;

      for (let i = lines.indexOf(line) + 1; i < lines.length; i++) {
        if (lines[i].includes("VSCODE-META-END")) {
          foundEnd = true;
          break;
        }
        metadataLineCount++;
      }

      if (foundEnd) {
        return metadataLineCount <= 3 ? "compact" : "traditional";
      }
    }
  }
  return "traditional"; // Default fallback
}

/**
 * Gets the desired metadata format based on current VSCode settings
 */
async function getDesiredMetadataFormat(): Promise<"single-line" | "compact" | "traditional"> {
  const config = vscode.workspace.getConfiguration("vizscript.metadata");
  const minifyFormat = config.get<string>("minifyFormat", "none");

  switch (minifyFormat) {
    case "both":
      return "single-line";
    case "compact":
      return "compact";
    case "vizOnly":
      // For local operations (Update metadata command), this should be traditional
      return "traditional";
    case "none":
    default:
      return "traditional";
  }
}

export function activate(context: vscode.ExtensionContext) {
  // The server is implemented in node
  let serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));

  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  let debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
  };

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    // Register the server for viz documents
    documentSelector: ["viz", "viz-con", "viz4", "viz4-con", "viz5", "viz5-con"],

    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: vscode.workspace.createFileSystemWatcher("**/.clientrc"),
    },
  };

  // Create the language client and start the client.
  client = new LanguageClient("vizscript", "VizScript", serverOptions, clientOptions);

  const diffContentProvider = new PreviewContentProvider();
  const providerRegistration = vscode.workspace.registerTextDocumentContentProvider("diff", diffContentProvider);
  context.subscriptions.push(providerRegistration);

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.getscripts", Commands.getAndDisplayVizScript.bind(this, context)),
  );

  const sidebarProvider = new SidebarProvider(context);
  const secondarySidebarProvider = new SidebarProvider(context);

  context.subscriptions.push(vscode.window.registerWebviewViewProvider("vizscript-sidebar", sidebarProvider));

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("vizscript-secondary-sidebar", secondarySidebarProvider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vizscript.fetchscripts",
      async (config: { hostname: string; port: number; selectedLayer: string }) => {
        await Commands.getAndPostVizScripts.bind(this)(context, sidebarProvider, config);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "vizscript");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.previewscript", async (vizId: string) => {
      await Commands.openScriptInTextEditor.bind(this)(context, client, vizId, true, true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.editscript", async (vizId: string) => {
      await Commands.openScriptInTextEditor.bind(this)(context, client, vizId, true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vizscript.setscript",
      async (config: { vizId: string; selectedLayer: string; hostname: string; port: number }) => {
        await Commands.compileCurrentScript.bind(this)(context, client, config);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.resetscripts", async () => {
      await Commands.resetScripts.bind(this)(context, client);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.previewdiff", async (vizId: string) => {
      await Commands.openScriptInDiff.bind(this)(context, vizId, true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.diff", async (vizId: string) => {
      await Commands.openScriptInDiff.bind(this)(context, vizId, true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.addmetadata", async () => {
      try {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
          vscode.window.showErrorMessage("No active editor found. Please open a script file first.");
          return;
        }

        // Check if it's a Viz script file
        const vizLanguages = ["viz", "viz-con", "viz4", "viz4-con", "viz5", "viz5-con"];
        if (!vizLanguages.includes(activeEditor.document.languageId)) {
          vscode.window.showErrorMessage("Current file is not a Viz script. Please open a .vs or .vsc file.");
          return;
        }

        const metadataService = new MetadataService(client);
        const fileService = new FileService();
        const document = activeEditor.document;
        const content = document.getText();

        // Determine script object properties from the file
        const fileName = path.basename(document.uri.fsPath);
        const baseName = fileName.replace(/\.(vs|vsc|viz|vizc|vs4|vs4c|viz4|viz4c|vs5|vs5c|viz5|viz5c)$/i, "");
        const isContainer = document.languageId.includes("con");

        const scriptObject: VizScriptObject = {
          vizId: "", // Will be empty, user needs to set it
          type: isContainer ? "Container" : "Scene",
          extension: isContainer ? ".vsc" : ".vs",
          name: baseName,
          code: content,
          scenePath: "", // Will be empty for containers, user needs to set it for scenes
          children: [],
          isGroup: false,
        };

        // Check if metadata exists in the document using the server
        const detectResult = await metadataService.detectMetadata(document.uri.toString());
        const hasMetadata = detectResult.hasMetadata;

        let newContent: string;
        let actionMessage: string;

        if (hasMetadata) {
          // Extract existing metadata and update/complete it
          const metadataResult = await metadataService.extractMetadataFromContent(content);

          if (metadataResult.success && metadataResult.metadata) {
            const existingMetadata = metadataResult.metadata;
            const completeMetadata = metadataService.createDefaultMetadata(scriptObject);

            // Merge existing with complete, preserving non-empty existing values
            const mergedMetadata = { ...completeMetadata };
            for (const [key, value] of Object.entries(existingMetadata)) {
              if (value !== null && value !== undefined && value !== "") {
                mergedMetadata[key] = value;
              }
            }

            // Check if there are content changes
            const hasContentChanges = JSON.stringify(existingMetadata) !== JSON.stringify(mergedMetadata);

            // Check if format needs updating based on current settings
            const currentLines = content.split(/\r?\n/g);
            const currentFormat = detectMetadataFormat(currentLines);
            const desiredFormat = await getDesiredMetadataFormat();
            const needsFormatUpdate = currentFormat !== desiredFormat;

            if (!hasContentChanges && !needsFormatUpdate) {
              vscode.window.showInformationMessage(
                "This script already has complete and valid metadata in the correct format.",
              );
              return;
            }

            // Update with proper format based on settings (local context)
            const updateResult = await metadataService.updateMetadataInContent(content, mergedMetadata);

            if (updateResult.success) {
              newContent = updateResult.content;

              // Determine what was changed
              const addedFields = Object.keys(mergedMetadata).filter(
                (key) =>
                  !existingMetadata.hasOwnProperty(key) ||
                  existingMetadata[key] === null ||
                  existingMetadata[key] === undefined ||
                  existingMetadata[key] === "",
              );

              let changeDescription = "";
              if (hasContentChanges && needsFormatUpdate) {
                changeDescription = `Added missing fields: ${addedFields.join(", ")} and updated format to ${desiredFormat}`;
              } else if (hasContentChanges) {
                changeDescription = `Added missing fields: ${addedFields.join(", ")}`;
              } else if (needsFormatUpdate) {
                changeDescription = `Updated format from ${currentFormat} to ${desiredFormat}`;
              }

              actionMessage = `Metadata updated! ${changeDescription}`;
            } else {
              vscode.window.showErrorMessage("Failed to update metadata: " + (updateResult.error || "Unknown error"));
              return;
            }
          } else {
            vscode.window.showErrorMessage("Failed to extract existing metadata: " + metadataResult.error);
            return;
          }
        } else {
          // No metadata exists, inject new metadata with proper format
          const injectionResult = await metadataService.injectMetadataIntoContent(content, scriptObject, "local");

          if (injectionResult.success) {
            newContent = injectionResult.content;
            actionMessage = "Metadata added successfully!";
          } else {
            vscode.window.showErrorMessage("Failed to add metadata: " + (injectionResult.message || "Unknown error"));
            return;
          }
        }

        // Apply the changes to the document
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(content.length));
        edit.replace(document.uri, fullRange, newContent);

        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
          vscode.window.showInformationMessage(actionMessage);
        } else {
          vscode.window.showErrorMessage("Failed to apply metadata changes to document.");
        }
      } catch (error) {
        console.error("Error in update metadata command:", error);
        vscode.window.showErrorMessage(`Failed to update metadata: ${error.message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.splitscriptgroup", async (groupVizId: string) => {
      await Commands.splitScriptGroup.bind(this)(context, groupVizId);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.mergescripts", async () => {
      await Commands.showMergeScriptsQuickPick.bind(this)(context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.mergeselectedscripts", async (vizIds: string[]) => {
      await Commands.mergeScriptsIntoGroup.bind(this)(context, vizIds);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.refreshsidebar", async () => {
      await Commands.refreshSidebar.bind(this)(context, sidebarProvider);
    }),
  );

  // Sidebar context menu commands
  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.sidebar.editScript", async () => {
      const selectedVizId = await getSelectedScriptFromSidebar(sidebarProvider);
      if (selectedVizId) {
        await Commands.openScriptInTextEditor.bind(this)(context, client, selectedVizId, true);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.sidebar.previewScript", async () => {
      const selectedVizId = await getSelectedScriptFromSidebar(sidebarProvider);
      if (selectedVizId) {
        await Commands.openScriptInTextEditor.bind(this)(context, client, selectedVizId, true, true);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.sidebar.diffScript", async () => {
      const selectedVizId = await getSelectedScriptFromSidebar(sidebarProvider);
      if (selectedVizId) {
        await Commands.openScriptInDiff.bind(this)(context, selectedVizId);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.sidebar.setScript", async () => {
      const selectedData = await getSelectedScriptDataFromSidebar(sidebarProvider);
      if (selectedData) {
        await Commands.compileCurrentScript.bind(this)(context, client, {
          vizId: selectedData.vizId,
          hostname: selectedData.hostname,
          port: selectedData.port,
          selectedLayer: selectedData.selectedLayer,
        });
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.sidebar.copyName", async () => {
      const scriptName = await getSelectedScriptNameFromSidebar(sidebarProvider);
      if (scriptName) {
        await vscode.env.clipboard.writeText(scriptName);
        vscode.window.showInformationMessage(`Copied "${scriptName}" to clipboard`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.sidebar.copyVizId", async () => {
      const selectedVizId = await getSelectedScriptFromSidebar(sidebarProvider);
      if (selectedVizId) {
        await vscode.env.clipboard.writeText(selectedVizId);
        vscode.window.showInformationMessage(`Copied "${selectedVizId}" to clipboard`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      "vizscript.setscript.main",
      Commands.setScriptInMainLayer.bind(this, context, client),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      "vizscript.setscript.front",
      Commands.setScriptInFrontLayer.bind(this, context, client),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand(
      "vizscript.setscript.back",
      Commands.setScriptInBackLayer.bind(this, context, client),
    ),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor != undefined) {
        client.sendRequest("setDocumentUri", editor.document.uri.toString());
      }
    }),
  );

  // Handle document saves to automatically update filePath in metadata
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      await handleDocumentSave(document, client);
    }),
  );

  //TODO: This should only happen in devmode

  const extensionDevPath = context.extensionPath;

  const clientPattern = new vscode.RelativePattern(`${extensionDevPath}`, "**/client/out/extension.js");
  const serverPattern = new vscode.RelativePattern(`${extensionDevPath}`, "**/server/out/**/*.js");
  const webviewPattern = new vscode.RelativePattern(`${extensionDevPath}`, "**/client/out/app.js");

  // Watcher for client files
  const clientWatcher = vscode.workspace.createFileSystemWatcher(clientPattern);
  clientWatcher.onDidChange(handleChange);

  // Watcher for server files
  const serverWatcher = vscode.workspace.createFileSystemWatcher(serverPattern);
  serverWatcher.onDidChange(handleChange);

  // Watcher for webview files
  const webviewWatcher = vscode.workspace.createFileSystemWatcher(webviewPattern);
  webviewWatcher.onDidChange(() => {
    console.info(`Webview changed. Reloading VSCode...`);
    vscode.commands.executeCommand("workbench.action.webview.reloadWebviewAction");
  });

  function handleChange({ scheme, path }) {
    console.info(`${scheme} ${path} changed. Reloading VSCode...`);
    vscode.commands.executeCommand("workbench.action.reloadWindow");
  }

  // Clean up watchers on extension deactivation
  context.subscriptions.push(clientWatcher, serverWatcher, webviewWatcher);

  /*   vscode.workspace.onDidChangeTextDocument(async (event) => {
    const {
      document: { uri },
    } = event;

    // Check if the document is a preview and if it has become dirty
    if (uri.scheme === "preview" && event.document.isDirty) {
      console.log(`Preview document '${event.document.fileName}' has become dirty.`);

      // Retrieve the content of the dirty preview document
      const content = event.document.getText();

      // Get the name of the preview document
      const name = event.document.fileName.replace(/^.*[\\\/]/, "");

      console.log(`Preview document name: ${name}`);

      // Close the existing preview document
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");

      // Open a new untitled document with the same name
      const untitledUri = vscode.Uri.parse(`untitled:${name}`);

      return vscode.workspace.openTextDocument(untitledUri).then((textDocument) => {
        const edit = new vscode.WorkspaceEdit();
        const lastLine = textDocument.lineCount;
        const lastChar = textDocument.lineAt(lastLine - 1).range.end.character;
        edit.delete(<vscode.Uri>untitledUri, new vscode.Range(0, 0, lastLine, lastChar));
        edit.insert(<vscode.Uri>untitledUri, new vscode.Position(0, 0), content);
        return Promise.all([<any>textDocument, vscode.workspace.applyEdit(edit)]);
      });
    }
  }); */

  vscode.workspace.onWillSaveTextDocument(async (event) => {
    const {
      document: { uri },
    } = event;

    //TODO: Implement this
    return;

    //TODO: Change this to check for VSCODE-META tags and send request to server to add to file

    // Check scheme of active document
    const activeUri = vscode.window.activeTextEditor?.document.uri;

    const state: VizScriptObject[] = await Commands.loadFromStorage(context);
    //check if state is larger than 0, if so destructure the first element
    if (state.length > 0) {
      //TODO: Add check to which vizscript object is selected and being saved
      const { scenePath, extension, name } = state[0];

      console.log("State", state);

      // Add selected file name to top of the file to save only if it is a viz file that is untitled
      if (activeUri?.scheme === "untitled" && (uri.path.endsWith(".vs") || uri.path.endsWith(".vsc"))) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const relativePath = workspaceFolder ? vscode.workspace.asRelativePath(uri) : uri.path;

        const edit = new vscode.WorkspaceEdit();
        edit.insert(
          uri,
          new vscode.Position(0, 0),
          `'VSCODE-META-START
'{
'  "scenePath": "${scenePath}",
'  "fileName": "${relativePath}",
'  "UUID": "${randomUUID()}"
'}
'VSCODE-META-END'\n`,
        );
        await vscode.workspace.applyEdit(edit);
      }
    }
  });

  client.start().then(() => {
    registerCommands(client, context);
    registerNotifications(client);
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
