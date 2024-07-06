import { PreviewFileSystemProvider } from "./previewFileSystemProvider";
import { SidebarProvider } from "./sidebarProvider";
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import {
  ExtensionContext,
  ProgressLocation,
  QuickPickItem,
  Range,
  Selection,
  StatusBarAlignment,
  StatusBarItem,
  TextEditor,
  ThemeColor,
  Uri,
  window,
  workspace,
} from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { diffWithActiveEditor } from "./showDiffWindow";
import { showMessage } from "./showMessage";
import { showPreviewWindow } from "./showPreviewWindow";
import { showUntitledWindow } from "./showUntitledWindow";
import { compileScript, compileScriptId, getVizScripts } from "./vizCommunication";
import { VizScriptObject } from "./shared/types";

export async function saveToStorage(context: ExtensionContext, data: any) {
  if (context.storageUri) {
    const filePath = Uri.joinPath(context.storageUri, "vizscriptData.json");
    const content = JSON.stringify(data);
    await workspace.fs.writeFile(filePath, Buffer.from(content));
  }
}

export async function loadFromStorage(context: ExtensionContext): Promise<VizScriptObject[]> {
  if (context.storageUri) {
    const filePath = Uri.joinPath(context.storageUri, "vizscriptData.json");
    const content = await workspace.fs.readFile(filePath);
    return JSON.parse(content.toString());
  }
}

export async function getAndDisplayVizScript(
  context: ExtensionContext,
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

    await openScriptInTextEditor(context, vizId, openInNewFile);
  } catch (error) {
    showMessage(error);
  }
}

export async function getAndPostVizScripts(
  context: ExtensionContext,
  sidebarProvider: SidebarProvider,
  config?: { hostname: string; port: number },
) {
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

          //const connectionInfo = await getConfig();
          const scripts = await getVizScripts(hostName, hostPort, context, progress);

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
  vizId: string,
  newFile: boolean,
  preview: boolean = false,
) {
  const state = await loadFromStorage(context);
  const scriptObjects: VizScriptObject[] = state;
  if (!scriptObjects) {
    throw new Error("No script objects found.");
  }
  const scriptObject = scriptObjects.find((element) => element.vizId === vizId);
  console.log(scriptObject);
  if (!scriptObject) {
    throw new Error("No script object found.");
  }

  const vizIdStripped = vizId.replace("#", "");

  if (preview) {
    await showPreviewWindow(vizIdStripped, scriptObject.name, scriptObject.extension, scriptObject.code, context);
  } else {
    await showUntitledWindow(vizIdStripped, scriptObject.name, scriptObject.extension, scriptObject.code, context);
  }
  /* else {
    if (!window.activeTextEditor) {
      throw new Error("No active text editor.");
    }
    context.workspaceState.update(window.activeTextEditor.document.uri.toString(), vizIdStripped);
    await window.activeTextEditor.edit((builder) => {
      if (!window.activeTextEditor) {
        throw new Error("No active text editor.");
      }
      const lastLine = window.activeTextEditor.document.lineCount;
      const lastChar = window.activeTextEditor.document.lineAt(lastLine - 1).range.end.character;
      builder.delete(new Range(0, 0, lastLine, lastChar));
      builder.replace(new Position(0, 0), scriptObject.code);
    });
  } */
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
    const reply = await getVizScripts(connectionInfo.hostName, Number(connectionInfo.hostPort), context);

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

export async function compileCurrentScript(context: ExtensionContext, client: LanguageClient, vizId: string) {
  try {
    const connectionString = await getConfig();
    if (!window.activeTextEditor) {
      throw new Error("No active text editor.");
    }

    try {
      await syntaxCheckCurrentScript(context, client);
    } catch (error) {
      throw new Error("Syntax error in script. Please correct before trying to set again.");
    }

    await compileScriptId(
      context,
      window.activeTextEditor.document.getText(),
      connectionString.hostName,
      connectionString.hostPort,
      vizId,
    );
    window.showInformationMessage("Script set successfully in Viz!");
  } catch (error) {
    showMessage(error);
  }
}

export async function syntaxCheckCurrentScript(context: ExtensionContext, client: LanguageClient): Promise<void> {
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
