import * as vscode from "vscode";
import { PreviewContentProvider } from "./previewContentProvider";

export function showUntitledWindow(
  id: string,
  name: string,
  fileExtension: string,
  content: string,
  context: vscode.ExtensionContext,
  previewContentProvider: PreviewContentProvider,
) {
  const uri = vscode.Uri.parse(`untitled:/${name}${fileExtension}`);

  return vscode.workspace
    .openTextDocument(uri)
    .then((textDocument) => {
      const edit = new vscode.WorkspaceEdit();
      const lastLine = textDocument.lineCount;
      const lastChar = textDocument.lineAt(lastLine - 1).range.end.character;
      edit.delete(<vscode.Uri>uri, new vscode.Range(0, 0, lastLine, lastChar));
      edit.insert(<vscode.Uri>uri, new vscode.Position(0, 0), content);
      return Promise.all([<any>textDocument, vscode.workspace.applyEdit(edit)]);
    })
    .then(([textDocument]) => {
      return vscode.window.showTextDocument(textDocument, { preview: true });
    })
    .then((result) => {
      context.workspaceState.update(result.document.uri.toString(), id);
    });
}
