import * as vscode from "vscode";
import { getNonce } from "./getNonce";

export class SidebarProvider implements vscode.WebviewViewProvider {
  _view?: vscode.WebviewView;
  _doc?: vscode.TextDocument;
  viewId: string;

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
        case "saveState":
          if (!data.value) {
            return;
          }
          if (this._context.storageUri) {
            const filePath = vscode.Uri.joinPath(this._context.storageUri, "vizscriptData.json");
            const content = JSON.stringify(data.value);
            await vscode.workspace.fs.writeFile(filePath, Buffer.from(content));
          }
          break;
        case "loadState":
          if (this._context.storageUri) {
            const filePath = vscode.Uri.joinPath(this._context.storageUri, "vizscriptData.json");
            const content = await vscode.workspace.fs.readFile(filePath);
            const state = JSON.parse(content.toString());
            webviewView.webview.postMessage({ type: "receiveState", value: state });
          }
          break;
        case "getscripts": {
          vscode.commands.executeCommand("vizscript.fetchscripts", data.value);
          break;
        }
        case "onScriptSelected": {
          vscode.commands.executeCommand("vizscript.openscriptinnewfile", data.value);
          break;
        }
        case "diff": {
          vscode.commands.executeCommand("vizscript.diff", data.value);
          break;
        }
        case "getSettings": {
          const settings = vscode.workspace.getConfiguration("vizscript");
          const compilerSettings = settings.compiler;
          webviewView.webview.postMessage({ type: "receiveSettings", value: compilerSettings });
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
