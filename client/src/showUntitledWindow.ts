/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import { Position, Uri, ViewColumn, WorkspaceEdit, window, workspace, Range, ExtensionContext } from "vscode";

export function showUntitledWindow(
  id: string,
  name: string,
  fileExtension: string,
  content: string,
  context: ExtensionContext,
) {
  const uri = Uri.parse(`untitled:${name}${id}${fileExtension}`);

  /*   // Store content in the workspace state
  context.workspaceState.update(`untitledContent:${id}`, content);

  // Retrieve and update the list of document IDs in the workspace state
  const documentIds = context.workspaceState.get<string[]>("untitledDocumentIds") || [];
  if (!documentIds.includes(id)) {
    documentIds.push(id);
    context.workspaceState.update("untitledDocumentIds", documentIds);
  } */

  return workspace
    .openTextDocument(uri)
    .then((textDocument) => {
      const edit = new WorkspaceEdit();
      const lastLine = textDocument.lineCount;
      const lastChar = textDocument.lineAt(lastLine - 1).range.end.character;
      edit.delete(<Uri>uri, new Range(0, 0, lastLine, lastChar));
      edit.insert(<Uri>uri, new Position(0, 0), content);
      return Promise.all([<any>textDocument, workspace.applyEdit(edit)]);
    })
    .then(([textDocument]) => {
      return window.showTextDocument(<any>textDocument, ViewColumn.One, false);
    })
    .then((result) => {
      context.workspaceState.update(result.document.uri.toString(), id);
    });
}

// Load content from the workspace state
export function reloadUntitledContent(id: string, context: ExtensionContext) {
  const content = context.workspaceState.get<string>(`untitledContent:${id}`);
  if (content) {
    const name = "untitledFile"; // The base name used when creating the untitled document
    const fileExtension = context.workspaceState.get<string>(`untitledExtension:${id}`); // The file extension used when creating the untitled document
    if (fileExtension) {
      showUntitledWindow(id, name, fileExtension, content, context);
    }
  }
}
