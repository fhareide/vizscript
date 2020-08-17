import * as fs from 'fs';
import * as path from 'path';
import { Position, Uri, ViewColumn, WorkspaceEdit, window, workspace, Range } from 'vscode';

export function showUntitledWindow(fileExtension: string, content: string, fallbackPath: string) {
  const uri = Uri.parse(`untitled:Untitled-1${fileExtension}`);

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
    });
}
