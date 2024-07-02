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
  const encodedContent = encodeURIComponent(content);
  const contentUri = Uri.parse(`diff:${name}${fileExtension}?${encodedContent}`);

  /*   // Store content in the workspace state
  context.workspaceState.update(`untitledContent:${id}`, content);

  // Retrieve and update the list of document IDs in the workspace state
  const documentIds = context.workspaceState.get<string[]>("untitledDocumentIds") || [];
  if (!documentIds.includes(id)) {
    documentIds.push(id);
    context.workspaceState.update("untitledDocumentIds", documentIds);
  } */

  return workspace
    .openTextDocument(contentUri)
    .then((textDocument) => {
      return window.showTextDocument(<any>textDocument, { preview: true });
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
