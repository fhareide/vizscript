/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import { Position, Uri, ViewColumn, WorkspaceEdit, window, workspace, Range, ExtensionContext } from "vscode";

export function showPreviewWindow(
  id: string,
  name: string,
  fileExtension: string,
  content: string,
  context: ExtensionContext,
) {
  const encodedContent = encodeURIComponent(content);
  const contentUri = Uri.parse(`diff:${name}(read-only)${fileExtension}?${encodedContent}`);

  return workspace
    .openTextDocument(contentUri)
    .then((textDocument) => {
      return window.showTextDocument(<any>textDocument, {
        preview: true,
        preserveFocus: true,
      });
    })
    .then((result) => {
      context.workspaceState.update(result.document.uri.toString(), id);
    });
}
