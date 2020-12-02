/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import { Position, Uri, ViewColumn, WorkspaceEdit, window, workspace, Range, ExtensionContext } from 'vscode';

export function showUntitledWindow(id: string, fileExtension: string, content: string, context: ExtensionContext) {
  const uri = Uri.parse(`untitled:Untitled${id}${fileExtension}`);

  return workspace.openTextDocument(uri)
    .then((textDocument) => {
			const edit = new WorkspaceEdit();
			const lastLine = textDocument.lineCount;
			const lastChar = textDocument.lineAt(lastLine - 1).range.end.character;
			edit.delete(<Uri>uri,new Range(0, 0, lastLine, lastChar));
			edit.insert(<Uri>uri,new Position(0,0),content);
      return Promise.all([<any>textDocument, workspace.applyEdit(edit)]);
    })
    .then(([textDocument]) => {

			return window.showTextDocument(<any>textDocument, ViewColumn.One, false);
		})
		.then(result =>{context.globalState.update(result.document.uri.toString(), id)});
}
