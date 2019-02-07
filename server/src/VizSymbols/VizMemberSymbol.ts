import * as ls from 'vscode-languageserver';
import { VizSymbol } from "./VizSymbol";

export class VizMemberSymbol extends VizSymbol {
	public GetLsSymbolKind(): ls.SymbolKind {
		return ls.SymbolKind.Field;
	}

	public GetLsCompletionItem(): ls.CompletionItem {
		let item = ls.CompletionItem.create(this.name);
		item.filterText = this.hint;
		item.insertText = this.name;
		item.kind = ls.CompletionItemKind.Field;
		item.data = this.type;
		item.documentation = this.args;
		item.detail = this.type;
		item.commitCharacters = ['.'];
		return item;
	}
}