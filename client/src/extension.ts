/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import * as vscode from "vscode";
import * as Commands from "./commands";

import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import { SidebarProvider } from "./sidebarProvider";

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

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.getscripts", Commands.getAndDisplayVizScript.bind(this, context)),
  );

  const sidebarProvider = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("vizscript-sidebar", sidebarProvider));

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vizscript.fetchscripts",
      Commands.getAndPostVizScripts.bind(this, context, sidebarProvider),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vizscript.openscriptinnewfile", async (vizId: string) => {
      await Commands.openScriptInTextEditor.bind(this)(vizId, true, context);
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor != undefined) {
        client.sendRequest("setDocumentUri", editor.document.uri.toString());
      }
    }),
  );

  client.start().then(() => {
    registerCommands(client, context);
    registerNotifications(client);

    /*     // Get the currently open text editors
    const openTextEditors = vscode.window.visibleTextEditors;

    // Filter out the untitled documents with .vs or .vsc extension
    const documentIdsToReload = openTextEditors
      .filter(
        (editor) =>
          editor.document.isUntitled &&
          (editor.document.fileName.endsWith(".vs") || editor.document.fileName.endsWith(".vsc")),
      )
      .map((editor) => context.workspaceState.get<string>(editor.document.uri.toString()));

    // Reload untitled content for each relevant document
    documentIdsToReload.forEach((id) => {
      if (id) reloadUntitledContent(id, context);
    }); */
  });
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
