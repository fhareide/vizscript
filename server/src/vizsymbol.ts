import * as ls from 'vscode-languageserver';

export class VizSymbol {
	public visibility: string = "";
	public name: string = "";
	public type: string = "";
	public args: string = "";
	public hint: string = "";
	public insertText: string = "";
	public symbolRange: ls.Range = null;
	public nameLocation: ls.Location = null;
	public noOfOverloads: number = 0;
	public overloads: VizSymbol[] = [];
	public children: VizSymbol[] = [];
	public kind: ls.CompletionItemKind;
	public signatureInfo: ls.SignatureInformation;
	public commitCharacters: string[] = [""];
	
	public parentName: string = "";

	public GetLsName(): string {
		return this.name;
	}

	public GetLsChildrenItems(): ls.CompletionItem[] {
		let symbols: ls.CompletionItem[] = [];
		this.children.forEach(symbol => {
			let item = ls.CompletionItem.create(symbol.name);
			item.filterText = symbol.name;
			item.insertText = symbol.insertText;
			item.kind = symbol.kind;
			item.data = symbol.type;
			item.documentation = symbol.args;
			item.detail = symbol.hint;
			item.commitCharacters = symbol.commitCharacters;
			symbols.push(item);
		});

		return symbols;
	}

	public GetLsCompletionItem(): ls.CompletionItem {
		let item = ls.CompletionItem.create(this.name);
		item.filterText = this.name;
		item.insertText = this.insertText;
		item.kind = this.kind;
		item.data = this.type;
		item.documentation = this.args;
		item.detail = this.hint;
		item.commitCharacters = this.commitCharacters;
		return item;
	}
	
	public static GetLanguageServerSymbols(symbols: VizSymbol[]): ls.SymbolInformation[] {
		let lsSymbols: ls.SymbolInformation[] = [];

		symbols.forEach(symbol => {
			let lsSymbol: ls.SymbolInformation = ls.SymbolInformation.create(
				symbol.name,
				symbol.kind,
				symbol.symbolRange,
				symbol.nameLocation.uri,
				symbol.parentName
			);
			lsSymbols.push(lsSymbol);
		});

		return lsSymbols;
	}

	public static GetLanguageServerCompletionItems(symbols: VizSymbol[]): ls.CompletionItem[] {
		let completionItems: ls.CompletionItem[] = [];

		symbols.forEach(symbol => {
			let lsItem = symbol.GetLsCompletionItem();
			completionItems.push(lsItem);
		});

		return completionItems;
	}
}