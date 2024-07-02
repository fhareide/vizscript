import { Event, EventEmitter, TextDocumentContentProvider, Uri } from "vscode";

export class DiffContentProvider implements TextDocumentContentProvider {
  private _onDidChange = new EventEmitter<Uri>();

  public provideTextDocumentContent(uri: Uri): string {
    return uri.query;
  }

  get onDidChange(): Event<Uri> {
    return this._onDidChange.event;
  }

  public update(uri: Uri) {
    this._onDidChange.fire(uri);
  }
}
