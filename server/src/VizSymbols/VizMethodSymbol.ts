import * as ls from 'vscode-languageserver';
import { VizSymbol } from "./VizSymbol";

export class VizMethodSymbol extends VizSymbol {
	public GetLsName(): string {
		return this.name + " (" + this.args + ")";
	}
	
	public GetLsSymbolKind(): ls.SymbolKind {
		return ls.SymbolKind.Method;
	}

	public GetLsCompletionItem(): ls.CompletionItem {
		let item = ls.CompletionItem.create(this.name);
		item.filterText = this.name;
		item.insertTextFormat = ls.InsertTextFormat.Snippet;
		item.insertText = this.name + "($1";
		item.kind = ls.CompletionItemKind.Method;
		item.data = this.type;
		item.documentation = this.type + " " + this.name + " (" + this.args + ")";
		item.detail = this.type + " " + this.name + " (" + this.args + ")";
		return item;
	}
}