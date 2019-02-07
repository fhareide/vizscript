import * as ls from 'vscode-languageserver';
import { VizSymbol } from "./VizSymbol";

export class VizClassSymbol extends VizSymbol {

	public GetLsCompletionItem(): ls.CompletionItem {
		let item = ls.CompletionItem.create(this.name);
		item.filterText = this.hint;
		item.insertText = this.name;
		item.kind = ls.CompletionItemKind.Class;
		item.data = this.type;
		item.documentation = this.args;
		item.detail = this.type;
		item.commitCharacters = ['.'];
		return item;
	}

}