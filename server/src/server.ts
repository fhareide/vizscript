/* --------------------------------------------------------------------------------------------
 * Copyright (c) Andreas Lenzen. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as ls from 'vscode-languageserver';
import { VizSymbol } from "./vizsymbol";
import * as olddata from './intellisense_data.json';
import * as data from './viz_completions.json';
import * as vizevent from './vizevent_completions.json';
import { HoverRequest } from 'vscode-languageserver';
import { create } from 'domain';
import { addListener } from 'cluster';
import { WorkspaceFoldersFeature } from 'vscode-languageserver/lib/workspaceFolders';

// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: ls.IConnection = ls.createConnection(new ls.IPCMessageReader(process), new ls.IPCMessageWriter(process));

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: ls.TextDocuments = new ls.TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
let workspaceRoot: string;
connection.onInitialize((params): ls.InitializeResult => {
	workspaceRoot = params.rootPath;
	//Initialize built in symbols
	if (symbolCache["builtin"] == null) GetBuiltinSymbols();
	if (symbolCache["builtin_events"] == null) GetVizEvents();

	return {
		capabilities: {
			// Tell the client that the server works in FULL text document sync mode
			textDocumentSync: documents.syncKind,
			//documentSymbolProvider: true,
			//signatureHelpProvider: {
            //    triggerCharacters: [ '(']
            //},
			// Tell the client that the server support code complete
			//definitionProvider: true,
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: ['.']
			},
			//hoverProvider: true
		}
	}
});


const pendingValidationRequests: { [uri: string]: NodeJS.Timer } = {};
const validationDelayMs = 500;

let LastType: string = "";

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change: ls.TextDocumentChangeEvent) => {
	//connection.console.log("Document changed. version: " + change.document.version.toString());
	//RefreshDocumentsSymbols(change.document.uri);
	triggerValidation(change.document);
});


// a document has closed: clear all diagnostics
documents.onDidClose(event => {
	cleanPendingValidation(event.document);
	connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

function cleanPendingValidation(textDocument: ls.TextDocument): void {
	const request = pendingValidationRequests[textDocument.uri];
	if (request) {
		clearTimeout(request);
		delete pendingValidationRequests[textDocument.uri];
	}
}

function triggerValidation(textDocument: ls.TextDocument): void {
	cleanPendingValidation(textDocument);
	pendingValidationRequests[textDocument.uri] = setTimeout(() => {
		delete pendingValidationRequests[textDocument.uri];
		RefreshDocumentsSymbols(textDocument.uri);
	}, validationDelayMs);
}

let names: Array<any> = [];

connection.onHover(({ textDocument, position }): ls.Hover => {    	
	return {contents: "Test"};
});

connection.onSignatureHelp((params: ls.TextDocumentPositionParams,cancelToken: ls.CancellationToken) : ls.SignatureHelp => {
    //connection.console.log("Should return signature help!");
	let result: ls.SignatureInformation[] = [];
	let test: ls.SignatureInformation;
	let parameters: ls.ParameterInformation[];
	let param: ls.ParameterInformation;
	param.label = "hello";
	parameters.push(param);
	test.label = "Hei";
	test.parameters = parameters;
	result.push(test);
    return {signatures: result, activeParameter: 0,activeSignature: 0};
});

connection.onDefinition((params: ls.TextDocumentPositionParams, cancelToken: ls.CancellationToken): ls.Definition => {

	//connection.console.log("Definition is: " + params.position.line.toString() + " " + params.position.character.toString());
	return null;
});


let lastSuggestions: ls.CompletionItem[] = [];
let lastType;
// This handler provides the initial list of the completion items.
connection.onCompletion((params: ls.CompletionParams, cancelToken: ls.CancellationToken): ls.CompletionItem[] => {
	let suggestions: ls.CompletionItem[] = [];
	let documentCompletions: ls.CompletionItem[] = [];


	//documentCompletions = SelectCompletionItems(params);

	

	// Gets current line
	let line: string = documents.get(params.textDocument.uri).getText(ls.Range.create(
		ls.Position.create(params.position.line, 0),
		ls.Position.create(params.position.line, params.position.character))
	);

	let start = 0;
	let startlast = 0;
	let regexResult;
	

	//Gets position of last '.'
	let count = 0;
	for (var i = params.position.character; i >= 0; i--) {
		if (line[i] == ".") {
			
			count++;
			if(count == 1){
			  start = i;
			}else if(count == 2){
			  startlast = i;
              i = 0;
			}
		}
	}

    connection.console.log("Start last is " + startlast);
	if (start > 0) {
		documentCompletions = [];
		connection.console.log("Start is " + start);
		let subString = line.substr(0, start + 1);
		let memberStartRegex: RegExp = /[\.]*([a-zA-Z0-9\-\_]+)*[\.]*$/gi;
		memberStartRegex.lastIndex = 0;
		regexResult = memberStartRegex.exec(subString);
		if (regexResult != null && regexResult.length > 0) {
			//connection.console.log("Result is - " + regexResult[1]);
			let item = GetSymbolByName(regexResult[1], params);
			if (item != null) {
				const symbols = symbolCache[params.textDocument.uri];
				if (symbols == []) return documentCompletions;
				let scopeSymbols = GetSymbolsOfScope(symbols, params.position);
				const builtinSymbols = symbolCache["builtin"];
				let currentType = "";
				scopeSymbols.forEach(item => {
					if (item.name == regexResult[1]) {
						//connection.console.log("Document - " + item.name + " should spawn help for " + item.type);
						let finalSymbols = GetSymbolByName(item.type, params).GetLsChildrenItems();
						currentType = item.type;
						suggestions = finalSymbols;
					}
				});
				if (!suggestions || suggestions.length === 0) {
					if (currentType == "") currentType = regexResult[1];
					builtinSymbols.forEach(item => {
						if (item.name == currentType) {
							let itemInternal = GetSymbolByName(item.type,params);
							let finalSymbols = itemInternal.GetLsChildrenItems();
							//connection.console.log("Builtin - " + itemInternal.name + " should spawn help for " + itemInternal.type);
							suggestions = finalSymbols;
						}
					});
				}
			} else {
			
			    let missingTypeName = regexResult[1];
			    let subString = line.substr(0, startlast + 1);
			    let memberStartRegex: RegExp = /[\.]*([a-zA-Z0-9\-\_]+)*[\.]*$/gi;
				memberStartRegex.lastIndex = 0;
				regexResult = memberStartRegex.exec(subString);
				//connection.console.log("Not found. Need to search by type - " + missingTypeName + " in children of " + regexResult[1] );
				
				let itemInternal = GetSymbolByName(regexResult[1],params);
				if(itemInternal != null){
					let searchSymbols = itemInternal.GetLsChildrenItems();
					searchSymbols.forEach(item => {
						if (item.filterText == missingTypeName) {
							let finalSymbols = GetSymbolByName(item.data, params).GetLsChildrenItems();
							//connection.console.log("Builtin - " + item.label + " should spawn help for " + item.data + " Found : " + finalSymbols.length);
							suggestions = finalSymbols;
						}
					});
				}
			  
			}
		}
	} else {
		let memberStartRegex: RegExp = /[ \t]+([a-zA-Z0-9\-\_\,]+)[ \t]+as[ \t]*/gi;
		memberStartRegex.lastIndex = 0;
		regexResult = memberStartRegex.exec(line);
		if (regexResult != null) {
			suggestions = suggestions.concat(SelectBuiltinCompletionItems());
		} else {
          if (line.length == 0){
			suggestions = documentCompletions.concat(VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin_events"]));
			suggestions = suggestions.concat(VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin_global"]));
			suggestions = suggestions.concat(VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin"]));
		  }
		}
		
		//suggestions = documentCompletions.concat(VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin_events"]));

	}

		//return documentCompletions;
	return suggestions;

});

function GetLastType(){

}

connection.onCompletionResolve((complItem: ls.CompletionItem): ls.CompletionItem => {
	return complItem;
});

function GetSymbolsOfDocument(uri: string): ls.SymbolInformation[] {
	RefreshDocumentsSymbols(uri);
	return VizSymbol.GetLanguageServerSymbols(symbolCache[uri]);
}

function GetSymbolByName(name: string, params: ls.CompletionParams): VizSymbol {
	let symbols = symbolCache["builtin"];
	let result: VizSymbol = null;
	symbols.forEach(item => {
		let childsymbols = item.children;
		if (item.name.toLowerCase() == name.toLowerCase()) {
			result = item;
		}
	});
	symbols = symbolCache[params.textDocument.uri];
	symbols = GetSymbolsOfScope(symbols, params.position);
	//connection.console.log("Symbols " + symbols.length)
	if (symbols == []) connection.console.log("No symbols found")
	symbols.forEach(item => {
		let childsymbols = item.children;
		if (item.name.toLowerCase() == name.toLowerCase()) {
			result = item;
		}
	});

	return result;
}

function GetSymbolByType(name: string, params: ls.CompletionParams): VizSymbol {
	let symbols = symbolCache["builtin"];
	let result: VizSymbol = null;
	symbols.forEach(item => {
		let childsymbols = item.children;
		if (item.type == name) {
			result = item;
			childsymbols.forEach(subitem => {
				if (subitem.type == name) {
					result = subitem;
				}
			});
		}
	});
	symbols = symbolCache[params.textDocument.uri];
	symbols = GetSymbolsOfScope(symbols, params.position);
	symbols.forEach(item => {
		let childsymbols = item.children;
		if (item.type == name) {
			result = item;
			childsymbols.forEach(subitem => {
				if (subitem.type == name) {
					result = subitem;
				}
			});
		}
	});

	return result;
}

function DisplayDiagnostics(uri: string, openMethod: OpenMethod): void {
	let diagnostics: ls.Diagnostic[] = [];

	let diagnostic: ls.Diagnostic = {
		severity: ls.DiagnosticSeverity.Error,
		range: openMethod.nameLocation.range,
		message: `${openMethod.name} is missing 'end sub'.`,
		source: 'vizsub Ts'
	};
	diagnostics.push(diagnostic);

	connection.sendDiagnostics({ uri, diagnostics });
}

function ClearDiagnostics(uri: string) {
	let diagnostics: ls.Diagnostic[] = [];
	connection.sendDiagnostics({ uri, diagnostics });
}

function SelectCompletionItems(textDocumentPosition: ls.TextDocumentPositionParams): ls.CompletionItem[] {
	let symbols = symbolCache[textDocumentPosition.textDocument.uri];

	if (symbols == null) {
		RefreshDocumentsSymbols(textDocumentPosition.textDocument.uri);
		symbols = symbolCache[textDocumentPosition.textDocument.uri];
		//connection.console.log("Rebuilt: Symbols length: " + symbols.length.toString() + textDocumentPosition.textDocument.uri);
	}

	let scopeSymbols = GetSymbolsOfScope(symbols, textDocumentPosition.position);
	return VizSymbol.GetLanguageServerCompletionItems(scopeSymbols);
}

function GetVizSymbolTree(symbols: VizSymbol[]) {
	// sort by start positition
	let sortedSymbols: VizSymbol[] = symbols.sort(function (a: VizSymbol, b: VizSymbol) {
		let diff = a.symbolRange.start.line - b.symbolRange.start.line;

		if (diff != 0)
			return diff;

		return a.symbolRange.start.character - b.symbolRange.start.character;
	});

	let root = new VizSymbolTree();

	for (var i = 0; i < sortedSymbols.length; i++) {
		var symbol = sortedSymbols[i];
		root.InsertIntoTree(symbol);
	}

	return root;
}

function GetSymbolsOfScope(symbols: VizSymbol[], position: ls.Position): VizSymbol[] {
	let symbolTree = GetVizSymbolTree(symbols);
	// bacause of hoisting we will have just a few possible scopes:
	// - file wide
	// - method of file wide
	// - class scope
	// - method or property of class scope

	return symbolTree.FindDirectParent(position).GetAllParentsAndTheirDirectChildren();
}

class VizSymbolTree {
	parent: VizSymbolTree = null;
	children: VizSymbolTree[] = [];
	data: VizSymbol = null;

	public InsertIntoTree(symbol: VizSymbol): boolean {
		if (this.data != null && !PositionInRange(this.data.symbolRange, symbol.symbolRange.start))
			return false;

		for (var i = 0; i < this.children.length; i++) {
			var symbolTree = this.children[i];
			if (symbolTree.InsertIntoTree(symbol))
				return true;
		}

		let newTreeNode = new VizSymbolTree();
		newTreeNode.data = symbol;
		newTreeNode.parent = this;

		this.children.push(newTreeNode);

		return true;
	}

	public FindDirectParent(position: ls.Position): VizSymbolTree {
		if (this.data != null && !PositionInRange(this.data.symbolRange, position))
			return null;

		for (var i = 0; i < this.children.length; i++) {
			let symbolTree = this.children[i];
			let found = symbolTree.FindDirectParent(position);
			if (found != null)
				return found;
		}

		return this;
	}

	public GetAllParentsAndTheirDirectChildren(): VizSymbol[] {
		let symbols: VizSymbol[];

		if (this.parent != null)
			symbols = this.parent.GetAllParentsAndTheirDirectChildren();
		else
			symbols = [];

		let childSymbols = this.children.map(function (symbolTree) {
			return symbolTree.data;
		});

		return symbols.concat(childSymbols);
	}
}

function PositionInRange(range: ls.Range, position: ls.Position): boolean {
	if (range.start.line > position.line)
		return false;

	if (range.end.line < position.line)
		return false;

	if (range.start.line == position.line && range.start.character >= position.character)
		return false;

	if (range.end.line == position.line && range.end.character <= position.character)
		return false;

	return true;
}

let symbolCache: { [id: string]: VizSymbol[]; } = {};
function RefreshDocumentsSymbols(uri: string) {
	let startTime: number = Date.now();
	let symbolsList: VizSymbol[] = CollectSymbols(documents.get(uri));
	symbolCache[uri] = symbolsList;
	//connection.console.info("Found " + symbolsList.length + " document symbols in '" + uri + "': " + (Date.now() - startTime) + " ms");
}

connection.onDocumentSymbol((docParams: ls.DocumentSymbolParams): ls.SymbolInformation[] => {
	return GetSymbolsOfDocument(docParams.textDocument.uri);
});

function CollectSymbols(document: ls.TextDocument): VizSymbol[] {
	let symbols: Set<VizSymbol> = new Set<VizSymbol>();
	let lines = document.getText().split(/\r?\n/g);

	for (var i = 0; i < lines.length; i++) {
		let line = lines[i];

		let containsComment = line.indexOf("'");
		//Removes comments from symbol lines
		if (containsComment > -1)
			line = line.substring(0, containsComment);

		//Remove literal strings
		let stringLiterals = /\"(([^\"]|\"\")*)\"/gi;
		line.replace(stringLiterals, ReplaceBySpaces);

		let statement: LineStatement = new LineStatement();
		statement.startLine = i;
		statement.line = line;
		statement.startCharacter = 0;


		//connection.console.info("Line " + i.toString() + " is " + statement.line);
		FindSymbol(statement, document.uri, symbols);
	}


	return Array.from(symbols);
}

class LineStatement {
	startCharacter: number = 0;
	startLine: number = -1;
	line: string = "";

	public GetStatement(): string {
		return this.line;
	}

	public GetPostitionByCharacter(charIndex: number): ls.Position {
		let internalIndex = charIndex - this.startCharacter;

		if (internalIndex < 0) {
			console.warn("WARNING: cannot resolve " + charIndex + " in me: " + JSON.stringify(this));
			return null;
		}


		return ls.Position.create(this.startLine, internalIndex + this.startCharacter);

	}
}

function ReplaceBySpaces(match: string): string {
	return " ".repeat(match.length);
}

function AddArrayToSet(s: Set<any>, a: any[]) {
	a.forEach(element => {
		s.add(element);
	});
}

function GetBuiltinSymbols() {
	let symbols: VizSymbol[] = [];
	let globalsymbols: VizSymbol[] = [];
	let startTime: number = Date.now();

	data.intellisense.completions.forEach(element => {
		if (element.name == "Global Procedures") {
			element.methods.forEach(submethod => {
				let symbol: VizSymbol = new VizSymbol();
				if (submethod.name.startsWith("\"Function")) symbol.kind = ls.CompletionItemKind.Function;
				else if (submethod.name.startsWith("\"Sub")) symbol.kind = ls.CompletionItemKind.Method;
				symbol.type = submethod.return_value;
				symbol.name = submethod.name;
				symbol.insertText = submethod.name;
				symbol.hint = submethod.code_hint;
				symbol.args = submethod.description;
				symbol.parentName = "root";
			    globalsymbols.push(symbol);
			});
		}
		else {
			let symbol: VizSymbol = new VizSymbol();
			symbol.kind = ls.CompletionItemKind.Class;
			symbol.name = element.name;
			symbol.insertText = element.name;
			symbol.parentName = "root";
			symbol.type = element.name;
			symbol.args = element.descripton;
			symbol.hint = "";
			symbols.push(symbol);

			element.methods.forEach(submethod => {
				let subSymbol: VizSymbol = new VizSymbol();
				subSymbol.type = submethod.return_value;
				subSymbol.name = submethod.name;
				subSymbol.insertText = submethod.name;
				subSymbol.hint = submethod.code_hint;
				subSymbol.args = submethod.description;
				if (submethod.name.startsWith("\"Function")) subSymbol.kind = ls.CompletionItemKind.Function;
				else if (submethod.name.startsWith("\"Sub")) subSymbol.kind = ls.CompletionItemKind.Method;
				subSymbol.parentName = element.name;
				symbol.children.push(subSymbol);
			});
			element.properties.forEach(properties => {
				let subSymbol: VizSymbol = new VizSymbol();
				subSymbol.type = properties.return_value;
				subSymbol.name = properties.name;
				subSymbol.insertText = properties.name;
				subSymbol.hint = properties.code_hint;
				subSymbol.args = properties.description;
				subSymbol.kind = ls.CompletionItemKind.Variable;
				subSymbol.parentName = element.name;
				symbol.children.push(subSymbol);
			});

		}
	});

	symbolCache["builtin"] = symbols;
	symbolCache["builtin_global"] = globalsymbols;
	//connection.console.info("Found " + symbols.length + " builtin symbols in " + (Date.now() - startTime) + " ms");
}

function GetVizEvents() {

	let symbols: VizSymbol[] = [];
	let startTime: number = Date.now();

	vizevent.events.forEach(event => {
		let symbol: VizSymbol = new VizSymbol();
		symbol.kind = ls.CompletionItemKind.Event;
		symbol.type = "Event";
		symbol.name = event.name;
		symbol.insertText = event.code_hint;
		symbol.hint = event.code_hint;
		symbol.args = event.description;
		symbol.parentName = "root";
		symbols.push(symbol);
	});

	symbolCache["builtin_events"] = symbols;
	//connection.console.info("Found " + symbols.length + " builtin events in " + (Date.now() - startTime) + " ms");
}

function SelectBuiltinCompletionItems(): ls.CompletionItem[] {
	return VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin"]);
}

function SelectBuiltinGlobalCompletionItems(): ls.CompletionItem[] {
	return VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin_global"]);
}

let pendingChildren: VizSymbol[] = [];

function FindSymbol(statement: LineStatement, uri: string, symbols: Set<VizSymbol>): void {
	let newSym: VizSymbol;
	let newSyms: VizSymbol[] = null;
	

	if (GetMethodStart(statement, uri)) {
		return;
	}

	newSyms = GetMethodSymbol(statement, uri);
	if (newSyms != null && newSyms.length != 0) {
		AddArrayToSet(symbols, newSyms);
		return;
	}

	if (GetStructureStart(statement, uri))
		return;

	newSym = GetStructureSymbol(statement, uri, pendingChildren);
	
	if (newSym != null) {
		symbols.add(newSym);
		pendingChildren = [];
		return;
	}

	newSym = GetMemberSymbol(statement, uri);
	if (newSym != null) {
		pendingChildren.push(newSym);
		return;
	}

	newSyms = GetVariableSymbol(statement, uri);
	if (newSyms != null && newSyms.length != 0) {
		AddArrayToSet(symbols, newSyms);
		return;
	}

}

let openStructureName: string = null;
let openStructureStart: ls.Position = ls.Position.create(-1, -1);

class OpenMethod {
	type: string;
	name: string;
	argsIndex: number;
	args: string;
	startPosition: ls.Position;
	nameLocation: ls.Location;
	statement: LineStatement;
}

let openMethod: OpenMethod = null;

function GetMethodStart(statement: LineStatement, uri: string): boolean {
	let line = statement.line;

	let rex: RegExp = /^[ \t]*(function|sub)+[ \t]+([a-zA-Z0-9\-\_]+)+[ \t]*(\(([a-zA-Z0-9\[\]\_\-, \t(\(\))]*)\))+[ \t]*(as)?[ \t]*([a-zA-Z0-9\-\_]*)?[ \t]*$/gi;

	let regexResult = rex.exec(line);

	if (regexResult == null || regexResult.length < 5)
		return;

	if (openMethod == null) {
		let leadingSpaces = GetNumberOfFrontSpaces(line);
		let preLength = leadingSpaces + regexResult.index;

		for (var i = 1; i < 3; i++) {
			var resElement = regexResult[i];
			if (resElement != null)
				preLength += resElement.length;
		}

		//connection.console.log("Opening bracket at: " + (preLength+1).toString());

		openMethod = {
			type: regexResult[1],
			name: regexResult[2],
			argsIndex: preLength + 1, // opening bracket
			args: regexResult[4],
			startPosition: statement.GetPostitionByCharacter(leadingSpaces),
			nameLocation: ls.Location.create(uri, ls.Range.create(
				statement.GetPostitionByCharacter(line.indexOf(regexResult[2])),
				statement.GetPostitionByCharacter(line.indexOf(regexResult[2]) + regexResult[2].length))
			),
			statement: statement
		};

		if (openMethod.args == null)
			openMethod.args = "";

		return true;
	} else {
		// ERROR!!! I expected "end function|sub"!

		DisplayDiagnostics(uri, openMethod);
		//console.error("ERROR - line " + statement.startLine + " at " + statement.startCharacter + ": 'end " + openMethod.type + "' expected!");
	}

	return false;
}

function GetMethodSymbol(statement: LineStatement, uri: string): VizSymbol[] {
	let line: string = statement.line;

	let classEndRegex: RegExp = /^[ \t]*end[ \t]+(function|sub)?[ \t]*$/gi;

	let regexResult = classEndRegex.exec(line);

	if (regexResult == null || regexResult.length < 2)
		return null;

	let type = regexResult[1];

	if (openMethod == null) {
		// ERROR!!! I cannot close any method!
		console.error("ERROR - line " + statement.startLine + " at " + statement.startCharacter + ": There is no " + type + " to end!");
		return null;
	}

	if (type.toLowerCase() != openMethod.type.toLowerCase()) {
		// ERROR!!! I expected end function|sub and not sub|function!
		// show the user the error and then go on like it was the right type!
		console.error("ERROR - line " + statement.startLine + " at " + statement.startCharacter + ": 'end " + openMethod.type + "' expected!");
	}

	let range: ls.Range = ls.Range.create(openMethod.startPosition, statement.GetPostitionByCharacter(GetNumberOfFrontSpaces(line) + regexResult[0].trim().length))

	let symbol: VizSymbol = new VizSymbol();
	symbol.kind = ls.CompletionItemKind.Method;
	symbol.type = openMethod.type;
	symbol.name = openMethod.name;
	symbol.insertText = openMethod.name;
	symbol.args = openMethod.args;
	symbol.nameLocation = openMethod.nameLocation;
	symbol.parentName = openStructureName;
	symbol.symbolRange = range;

	let parametersSymbol = [];
	parametersSymbol = GetParameterSymbols(openMethod.name, openMethod.args, openMethod.argsIndex, openMethod.statement, uri);

	openMethod = null;
	ClearDiagnostics(uri);
	//return [symbol];
	return parametersSymbol.concat(symbol);
}

function ReplaceAll(target: string, search: string, replacement: string): string {
	return target.replace(new RegExp(search, 'g'), replacement);
};

function GetParameterSymbols(name: string, args: string, argsIndex: number, statement: LineStatement, uri: string): VizSymbol[] {
	let symbols: VizSymbol[] = [];
	let MethodSignature: ls.SignatureInformation = ls.SignatureInformation.create(name);

	let parameters: ls.ParameterInformation[] = [];



	if (args == null || args == "")
		return symbols;

	let argsSplitted: string[] = args.split(',');

	for (let i = 0; i < argsSplitted.length; i++) {
		let arg = argsSplitted[i];

		let paramRegEx: RegExp = /^[ \t]*(byval|byref)?[ \t]*([a-zA-Z0-9\-\_]+)+[ \t]*(as)+[ \t]*([a-zA-Z0-9\-\_]*)+[ \t]*$/gi;

		let regexResult = paramRegEx.exec(arg);

		if (regexResult == null || regexResult.length < 3)
			return symbols;

		let varSymbol: VizSymbol = new VizSymbol();
		varSymbol.kind = ls.CompletionItemKind.Variable;
		varSymbol.args = "";
		varSymbol.type = "";

		varSymbol.name = regexResult[2].trim();
		varSymbol.insertText = varSymbol.name;
		varSymbol.type = regexResult[4].trim();

		let range = ls.Range.create(
			statement.GetPostitionByCharacter(argsIndex + arg.indexOf(varSymbol.name)),
			statement.GetPostitionByCharacter(argsIndex + arg.indexOf(varSymbol.name) + varSymbol.name.length)
		);
		varSymbol.nameLocation = ls.Location.create(uri, range);
		varSymbol.symbolRange = range;

		symbols.push(varSymbol);
		argsIndex += arg.length + 1; // comma
	}

	return symbols;
}

function GetNumberOfFrontSpaces(line: string): number {
	let counter: number = 0;

	for (var i = 0; i < line.length; i++) {
		var char = line[i];
		if (char == " " || char == "\t")
			counter++;
		else
			break;
	}

	return counter;
}

class OpenProperty {
	type: string;
	name: string;
	argsIndex: number;
	args: string;
	startPosition: ls.Position;
	nameLocation: ls.Location;
	statement: LineStatement;
}

let openProperty: OpenProperty = null;


function GetMemberSymbol(statement: LineStatement, uri: string): VizSymbol {

	if (openStructureName == null)//No structure is open. There can't be any members of nothing.
		return null;

	let line: string = statement.line;

	let memberStartRegex: RegExp = /^[ \t]*([a-zA-Z0-9\-\_\,]+)[ \t]+as[ \t]+([a-zA-Z0-9\-\_\,\[\]]+).*$/gi;
	let regexResult = memberStartRegex.exec(line);

	if (regexResult == null || regexResult.length < 3)
		return null;

	let name = regexResult[1];
	let type = regexResult[2];
	let intendention = GetNumberOfFrontSpaces(line);
	let nameStartIndex = line.indexOf(line);

	let range: ls.Range = ls.Range.create(
		statement.GetPostitionByCharacter(intendention),
		statement.GetPostitionByCharacter(intendention + regexResult[0].trim().length)
	);

	let symbol: VizSymbol = new VizSymbol();
	symbol.kind = ls.CompletionItemKind.Field;
	symbol.type = type
	symbol.name = name;
	symbol.insertText = name;
	symbol.args = "";
	symbol.symbolRange = range;
	symbol.nameLocation = ls.Location.create(uri,
		ls.Range.create(
			statement.GetPostitionByCharacter(nameStartIndex),
			statement.GetPostitionByCharacter(nameStartIndex + name.length)
		)
	);
	symbol.parentName = openStructureName;

	return symbol;
}

function GetVariableNamesFromList(vars: string): string[] {
	return vars.split(',').map(function (s) { return s.trim(); });
}

function GetVariableSymbol(statement: LineStatement, uri: string): VizSymbol[] {
	let line: string = statement.line;

	let variableSymbols: VizSymbol[] = [];
	let memberStartRegex: RegExp = /^[ \t]*dim[ \t]+([a-zA-Z0-9\-\_\,]+)[ \t]+as[ \t]+([a-zA-Z0-9\-\_\,\[\]]+).*$/gi;

	let regexResult = memberStartRegex.exec(line);

	if (regexResult == null || regexResult.length < 3)
		return null;

	// (dim[ \t]+)
	let variables = GetVariableNamesFromList(regexResult[1]);
	let intendention = GetNumberOfFrontSpaces(line);
	let nameStartIndex = line.indexOf(line);
	let parentName: string = "";
	let type: string = regexResult[2]

	if (openStructureName != null)
		parentName = openStructureName;

	if (openMethod != null)
		parentName = openMethod.name;

	if (openProperty != null)
		parentName = openProperty.name;

	for (let i = 0; i < variables.length; i++) {
		let varName = variables[i];
		let symbol: VizSymbol = new VizSymbol();
		symbol.type = type;
		symbol.name = varName;
		symbol.insertText = varName;
		symbol.args = "";
		symbol.nameLocation = ls.Location.create(uri,
			GetNameRange(statement, varName)
		);

		symbol.symbolRange = ls.Range.create(
			ls.Position.create(symbol.nameLocation.range.start.line, symbol.nameLocation.range.start.character),
			ls.Position.create(symbol.nameLocation.range.end.line, symbol.nameLocation.range.end.character)
		);

		symbol.parentName = parentName;

		variableSymbols.push(symbol);
	}

	return variableSymbols;
}

function GetNameRange(statement: LineStatement, name: string): ls.Range {
	let line: string = statement.line;

	let findVariableName = new RegExp("(" + name.trim() + "[ \t]*)", "gi");
	let matches = findVariableName.exec(line);

	let rng = ls.Range.create(
		statement.GetPostitionByCharacter(matches.index),
		statement.GetPostitionByCharacter(matches.index + name.trim().length)
	);

	return rng;
}

function GetStructureStart(statement: LineStatement, uri: string): boolean {
	let line: string = statement.line;

	let classStartRegex: RegExp = /^[ \t]*structure[ \t]+([a-zA-Z0-9\-\_]+)[ \t]*$/gi;
	let regexResult = classStartRegex.exec(line);

	if (regexResult == null || regexResult.length < 2)
		return false;

	let name = regexResult[1];
	openStructureName = name;
	openStructureStart = statement.GetPostitionByCharacter(GetNumberOfFrontSpaces(line));

	return true;
}

function GetStructureSymbol(statement: LineStatement, uri: string, children: VizSymbol[]): VizSymbol {
	let line: string = statement.line;

	let classEndRegex: RegExp = /^[ \t]*end[ \t]+structure[ \t]*$/gi;

	if (openStructureName == null)
		return null;

	let regexResult = classEndRegex.exec(line);

	if (regexResult == null || regexResult.length < 1)
		return null;

	if (openMethod != null) {
		// ERROR! expected to close method before!
		console.error("ERROR - Structure - line " + statement.startLine + " at " + statement.startCharacter + ": 'end " + openMethod.type + "' expected!");
	}

	if (openProperty != null) {
		// ERROR! expected to close property before!
		console.error("ERROR - Structure - line " + statement.startLine + " at " + statement.startCharacter + ": 'end property' expected!");
	}

	let range: ls.Range = ls.Range.create(openStructureStart, statement.GetPostitionByCharacter(regexResult[0].length))
	let symbol: VizSymbol = new VizSymbol();
	symbol.kind = ls.CompletionItemKind.Struct;
	symbol.name = openStructureName;
	symbol.type = "Structure"
	symbol.insertText = symbol.name;
	symbol.nameLocation = ls.Location.create(uri,
		ls.Range.create(openStructureStart,
			ls.Position.create(openStructureStart.line, openStructureStart.character + openStructureName.length)
		)
	);
	symbol.symbolRange = range;
	symbol.children = children;

	
	//let symbol: ls.SymbolInformation = ls.SymbolInformation.create(openClassName, ls.SymbolKind.Class, range, uri);

	openStructureName = null;
	openStructureStart = ls.Position.create(-1, -1);

	return symbol;
}



/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log("created!");
	//RefreshDocumentsSymbols(params.textDocument.uri);
	//connection.console.log(`${params.textDocument.uri} opened.`);
});5
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	//RefreshDocumentsSymbols(params.textDocument.uri);
	connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});

*/
connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	symbolCache[params.textDocument.uri] = null;
	//connection.console.log(`${params.textDocument.uri} closed.`);
});

// Listen on the connection
connection.listen();