import * as vscode from "vscode";

export function showUntitledWindow(
  id: string,
  name: string,
  fileExtension: string,
  content: string,
  context: vscode.ExtensionContext,
) {
  // Create an untitled URI with the specified file extension
  const uri = vscode.Uri.parse(`untitled:${name}${fileExtension}`);

  return vscode.workspace
    .openTextDocument(uri)
    .then((textDocument) => {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(textDocument.uri, new vscode.Position(0, 0), content);
      return vscode.workspace.applyEdit(edit).then(() => textDocument);
    })
    .then((textDocument) => {
      // Show the newly created text document
      return vscode.window.showTextDocument(textDocument);
    })
    .then((editor) => {
      // Listen for willSaveTextDocument event to trigger "Save As"
      const disposable = vscode.workspace.onWillSaveTextDocument((event) => {
        if (event.document.uri.scheme === "untitled") {
          // Trigger "Save As" command for untitled documents
          vscode.commands.executeCommand("workbench.action.files.saveAs", event.document.uri);
          // Note: There's no need to call event.waitUntil() here.
        }
      });

      // Ensure the event listener is disposed when no longer needed
      context.subscriptions.push(disposable);

      return editor;
    });
}
