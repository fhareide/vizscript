import * as fs from 'fs';
import * as path from 'path';
import { Position, Uri, ViewColumn, WorkspaceEdit, window, workspace, Range } from 'vscode';

export function showUntitledWindow(fileName: string, content: string, fallbackPath: string) {
  const filePath = path.join(workspace.rootPath || fallbackPath, fileName);
  const uri = Uri.parse(`untitled:${filePath}`);

  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    fs.unlinkSync(filePath);
  } catch (err) {
    ;
  }

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
