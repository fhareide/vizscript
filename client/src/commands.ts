/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import {
  ExtensionContext,
  Position,
  QuickPickItem,
  Range,
  Selection,
  StatusBarAlignment,
  StatusBarItem,
  TextEditor,
  ThemeColor,
  window,
  workspace,
} from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { showMessage } from "./showMessage";
import { showUntitledWindow } from "./showUntitledWindow";
import { compileScript, compileScriptId, getVizScripts } from "./vizCommunication";
import { VizScriptObject } from "./vizScriptObject";

let scriptObjects: VizScriptObject[];

export async function displayScriptSelector(context: ExtensionContext) {
  window.setStatusBarMessage("Fetching script list from Viz...", 5000);

  try {
    const connectionString = await getConfig();
    const selectedScript = await requestAllScripts(connectionString);

    if (!selectedScript) {
      throw new Error("No script selected.");
    }

    let elements: QuickPickItem[] = [];
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
      elements = [newFileItem];
    } else {
      elements = [newFileItem, currentFileItem];
    }

    const selection = await window.showQuickPick(elements, {
      matchOnDescription: true,
      matchOnDetail: false,
      placeHolder: "Select your script",
    });

    if (!selection) {
      throw new Error("No selection made.");
    }

    let vizId = (<QuickPickItem>selectedScript).label;
    const scriptObject = scriptObjects.find((element) => element.vizId === vizId);
    console.log(scriptObject);
    if (!scriptObject) {
      throw new Error("No script object found.");
    }

    if (selection.label === "Add script to current file") {
      if (!window.activeTextEditor) {
        throw new Error("No active text editor.");
      }
      context.workspaceState.update(window.activeTextEditor.document.uri.toString(), vizId);
      await window.activeTextEditor.edit((builder) => {
        if (!window.activeTextEditor) {
          throw new Error("No active text editor.");
        }
        const lastLine = window.activeTextEditor.document.lineCount;
        const lastChar = window.activeTextEditor.document.lineAt(lastLine - 1).range.end.character;
        builder.delete(new Range(0, 0, lastLine, lastChar));
        builder.replace(new Position(0, 0), scriptObject.code);
      });
    } else if (selection.label === "Open script in new file") {
      await showUntitledWindow(vizId, scriptObject.extension, scriptObject.code, context);
    }
  } catch (error) {
    showMessage(error);
  }
}

export async function requestAllScripts(connectionInfo: VizScriptCompilerSettings) {
  window.setStatusBarMessage("Getting viz scripts...", 5000);

  try {
    const reply = await getVizScripts(connectionInfo.hostName, Number(connectionInfo.hostPort));
    console.log(reply);
    scriptObjects = reply;

    let elements = scriptObjects.map((element: VizScriptObject) => {
      return {
        description: `${element.type} ${element.name}`,
        label: element.vizId,
        detail: element.code.substr(0, 100),
      };
    });

    return window.showQuickPick(elements, {
      matchOnDescription: true,
      matchOnDetail: false,
      placeHolder: "Select your script",
    });
  } catch (reason) {
    throw new Error(reason);
  }
}

let compileMessage: StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 0);

export async function compileCurrentScript(context: ExtensionContext, client: LanguageClient, editor: TextEditor) {
  try {
    const result: [string, string, string] = await client.sendRequest("getVizConnectionInfo");
    if (!window.activeTextEditor) {
      throw new Error("No active text editor.");
    }
    const linkedId: string = context.workspaceState.get(window.activeTextEditor.document.uri.toString()) || "";
    const message = await compileScriptId(
      window.activeTextEditor.document.getText(),
      result[0],
      Number(result[1]),
      result[2],
      linkedId,
    );

    const [error, rangeString]: [string, string] = await client.sendRequest("showDiagnostics", message);

    if (error === "OK") {
      compileMessage.text = "$(check) Script successfully set in Viz. No errors";
      compileMessage.backgroundColor = "";
      showStatusMessage(compileMessage);
    } else {
      const [line, char] = rangeString.split("/").map(Number);
      const range = new Range(line - 1, 0, line - 1, char);
      const editor = window.activeTextEditor;
      editor.selection = new Selection(range.start, range.end);
      editor.revealRange(range);

      compileMessage.text = "$(error) " + error;
      compileMessage.backgroundColor = new ThemeColor("statusBarItem.errorBackground");
      showStatusMessage(compileMessage);
    }
  } catch (error) {
    showMessage(error);
  }
}

export async function syntaxCheckCurrentScript(context: ExtensionContext, client: LanguageClient, editor: TextEditor) {
  try {
    const result: [string, string, string] = await client.sendRequest("getVizConnectionInfo");
    if (!window.activeTextEditor) {
      throw new Error("No active text editor.");
    }
    const message = await compileScript(
      window.activeTextEditor.document.getText(),
      result[0],
      Number(result[1]),
      result[2],
    );

    const [error, rangeString]: [string, string] = await client.sendRequest("showDiagnostics", message);

    if (error === "OK") {
      compileMessage.text = "$(check) Compile OK";
      compileMessage.backgroundColor = "";
      showStatusMessage(compileMessage);
    } else {
      const [line, char] = rangeString.split("/").map(Number);
      const range = new Range(line - 1, 0, line - 1, char);
      const editor = window.activeTextEditor;
      editor.selection = new Selection(range.start, range.end);
      editor.revealRange(range);

      compileMessage.text = "$(error) " + error;
      compileMessage.backgroundColor = new ThemeColor("statusBarItem.errorBackground");
      showStatusMessage(compileMessage);
    }
  } catch (error) {
    showMessage(error);
  }
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
