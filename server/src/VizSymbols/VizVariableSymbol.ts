import * as ls from 'vscode-languageserver';
import { VizSymbol } from "./VizSymbol";

export class VizVariableSymbol extends VizSymbol {

	public GetLsCompletionItem(): ls.CompletionItem {
		let item = ls.CompletionItem.create(this.name);
		item.documentation = this.visibility + " " + this.type + " " + this.name + "(" + this.args + ")"
		item.filterText = this.hint;
		item.insertText = this.name;
		item.kind = ls.CompletionItemKind.Variable;
		item.data = this.type;
		return item;
	}
}