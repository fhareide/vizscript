import * as vscode from "vscode";
import { PreviewContentProvider } from "./previewContentProvider";

export function showPreviewWindow(
  id: string,
  name: string,
  fileExtension: string,
  content: string,
  context: vscode.ExtensionContext,
  previewContentProvider: PreviewContentProvider,
) {
  const uri = vscode.Uri.parse(`preview:/${name}${fileExtension}`);

  previewContentProvider.writeFile(uri, Buffer.from(content, "utf8"), { create: true, overwrite: true });

  return vscode.workspace
    .openTextDocument(uri)
    .then((textDocument) => {
      return vscode.window.showTextDocument(textDocument, { preview: true });
    })
    .then((result) => {
      context.workspaceState.update(result.document.uri.toString(), id);
    });
}
