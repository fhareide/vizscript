import * as vscode from "vscode";
import { PreviewFileSystemProvider } from "./previewFileSystemProvider";

export interface PreviewFile {
  id: string;
  name: string;
  fileExtension: string;
  content: string;
}

export function showEditablePreviewWindow(
  id: string,
  name: string,
  fileExtension: string,
  content: string,
  context: vscode.ExtensionContext,
  previewFileSystemProvider: PreviewFileSystemProvider,
) {
  const uri = vscode.Uri.parse(`preview:/${name}${fileExtension}`);

  const previewFile: PreviewFile = { id, name, fileExtension, content };

  context.workspaceState.update(uri.toString(), previewFile);

  previewFileSystemProvider.writeFile(uri, Buffer.from(content, "utf8"), { create: true, overwrite: true });

  return vscode.workspace
    .openTextDocument(uri)
    .then((textDocument) => {
      return vscode.window.showTextDocument(textDocument, { preview: true });
    })
    .then((result) => {
      context.workspaceState.update(result.document.uri.toString(), id);
    });
}
