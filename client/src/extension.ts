/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import * as vscode from "vscode";
import * as Commands from "./commands";

import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import { SidebarProvider } from "./sidebarProvider";
import { PreviewContentProvider } from "./previewContentProvider";
import { PreviewFileSystemProvider } from "./previewFileSystemProvider";
import { PreviewFile } from "./showEditablePreviewWindow";

let client: LanguageClient;

async function handleSaveAs(uri: vscode.Uri) {
  // get workspace folder
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const startPath = workspaceFolder ? workspaceFolder.uri.fsPath : "";

  const defaultUri = vscode.Uri.file(startPath);
  const options: vscode.SaveDialogOptions = {
    defaultUri,
    saveLabel: "Save",
    filters: {
      // Define filters if needed
    },
  };
  const saveUri = await vscode.window.showSaveDialog(options);
  if (saveUri) {
    // Save the content of the preview file (`uri`) to `saveUri`
    const previewFileContent = await vscode.workspace.fs.readFile(uri);
    await vscode.workspace.fs.writeFile(saveUri, previewFileContent);

    // Close the current preview file
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

    // Open the newly saved file
    await vscode.commands.executeCommand("vscode.open", saveUri);
  }
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
    vscode.commands.registerCommand("vizscript.diff", async (vizId: string) => {
      await Commands.openScriptInDiff.bind(this)(context, vizId, true);
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor != undefined) {
        client.sendRequest("setDocumentUri", editor.document.uri.toString());
      }
    }),
  );

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

  /*   vscode.workspace.onWillSaveTextDocument(async (event) => {
    const {
      document: { uri },
    } = event;
    if (uri.scheme === "preview") {
      // Handle save logic for preview files
      // For example, prompt user to save the file somewhere permanent
      await handleSaveAs(uri);
    }
  });

  vscode.workspace.onDidSaveTextDocument(async (document) => {
    const { uri } = document;
    if (uri.scheme === "preview") {
      // Handle save logic for preview files after they are saved
    }
  }); */

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
