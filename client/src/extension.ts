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
import { randomUUID } from "crypto";

let client: LanguageClient;

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
      async (config: { hostName: string; hostPort: Number }) =>
        await Commands.getAndPostVizScripts.bind(this)(context, sidebarProvider, config),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "vizscript");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.previewscript", async (vizId: string) => {
      await Commands.openScriptInTextEditor.bind(this)(context, vizId, true, true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.editscript", async (vizId: string) => {
      await Commands.openScriptInTextEditor.bind(this)(context, vizId, true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.setscript", async (vizId: string) => {
      await Commands.compileCurrentScript.bind(this)(context, client, vizId, true);
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
      await client.sendRequest("addMetaDataItem");
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor != undefined) {
        client.sendRequest("setDocumentUri", editor.document.uri.toString());
      }
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
