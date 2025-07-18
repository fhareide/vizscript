import * as vscode from "vscode";
import { getNonce } from "./getNonce";
import { loadFromStorage } from "./commands";

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  _doc?: vscode.TextDocument;
  viewId: string;

  private static instances: Map<string, SidebarProvider> = new Map();

  constructor(private readonly _context: vscode.ExtensionContext) {
    this.viewId = "default";
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    // Determine viewId based on the webviewView title
    if (webviewView.viewType === "vizscript-sidebar") {
      this.viewId = "main";
    } else if (webviewView.viewType === "vizscript-secondary-sidebar") {
      this.viewId = "secondary";
    } else {
      this.viewId = "default"; // Handle default case if needed
    }

    // Register this instance
    SidebarProvider.instances.set(this.viewId, this);

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,

      localResourceRoots: [
        this._context.extensionUri,
        vscode.Uri.joinPath(this._context.extensionUri, "client/out"),
        vscode.Uri.joinPath(this._context.extensionUri, "client/media"),
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview, this.viewId);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "onInfo": {
          if (!data.value) {
            return;
          }
          vscode.window.showInformationMessage(data.value);
          break;
        }
        case "onError": {
          if (!data.value) {
            return;
          }
          vscode.window.showErrorMessage(data.value);
          break;
        }
        case "loadState":
          const state = await loadFromStorage(this._context);
          webviewView.webview.postMessage({ type: "receiveState", value: state });

          break;
        case "fetchscripts": {
          vscode.commands.executeCommand("vizscript.fetchscripts", data.value);
          break;
        }
        case "onScriptSelected": {
          vscode.commands.executeCommand("vizscript.previewscript", data.value);
          break;
        }
        case "diff": {
          vscode.commands.executeCommand("vizscript.diff", data.value);
          break;
        }
        case "editScript": {
          vscode.commands.executeCommand("vizscript.editscript", data.value);
          break;
        }
        case "editScriptForceRefresh": {
          vscode.commands.executeCommand("vizscript.editscriptforcerefresh", data.value);
          break;
        }
        case "setScript": {
          vscode.commands.executeCommand("vizscript.setscript", data.value);
          break;
        }
        case "resetScripts": {
          vscode.commands.executeCommand("vizscript.resetscripts");
          break;
        }
        case "getSettings": {
          const settings = vscode.workspace.getConfiguration("vizscript");
          const compilerSettings = settings.compiler;
          const sidebarSettings = settings.sidebar;
          const allSettings = {
            ...compilerSettings,
            sidebar: sidebarSettings,
          };
          webviewView.webview.postMessage({ type: "receiveSettings", value: allSettings });
          break;
        }
        case "splitGroup": {
          vscode.commands.executeCommand("vizscript.splitscriptgroup", data.value);
          break;
        }
        case "mergeScripts": {
          vscode.commands.executeCommand("vizscript.mergescripts");
          break;
        }
        case "mergeSelectedScripts": {
          vscode.commands.executeCommand("vizscript.mergeselectedscripts", data.value);
          break;
        }
        case "executeCommand": {
          vscode.commands.executeCommand(data.value);
          break;
        }
        case "getScriptParameters": {
          vscode.commands.executeCommand("vizscript.getscriptparameters", data.value);
          break;
        }
        case "setScriptParameter": {
          vscode.commands.executeCommand("vizscript.setscriptparameter", data.value);
          break;
        }
        case "invokeScriptParameter": {
          vscode.commands.executeCommand("vizscript.invokescriptparameter", data.value);
          break;
        }
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview, viewId: string) {
    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "client/media", "reset.css"),
    );
    const styleVSCodeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "client/media", "vscode.css"),
    );
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, "client/out", "app.js"));
    const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, "client/out", "app.css"));

    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <!--
          Use a content security policy to only allow loading images from https or from our extension directory,
          and only allow scripts that have a specific nonce.
        -->
        <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleResetUri}" rel="stylesheet">
        <link href="${styleMainUri}" rel="stylesheet">
        <link href="${styleVSCodeUri}" rel="stylesheet">
        <script nonce="${nonce}">
          const tsvscode = acquireVsCodeApi();
          window.viewId = "${viewId}";
        </script>
      </head>
      <body>
        <div id="app"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>`;
  }

  public revive(panel: vscode.WebviewView) {
    this._view = panel;
  }
}
