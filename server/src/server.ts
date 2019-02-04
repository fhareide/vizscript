/* --------------------------------------------------------------------------------------------
 * Copyright (c) Andreas Lenzen. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as ls from 'vscode-languageserver';
import { VBSSymbol } from "./VBSSymbols/VBSSymbol";
import { VBSMethodSymbol } from './VBSSymbols/VBSMethodSymbol';
import { VBSPropertySymbol } from './VBSSymbols/VBSPropertySymbol';
import { VBSClassSymbol } from './VBSSymbols/VBSClassSymbol';
import { VBSMemberSymbol } from './VBSSymbols/VBSMemberSymbol';
import { VBSVariableSymbol } from './VBSSymbols/VBSVariableSymbol';
import { VBSConstantSymbol } from './VBSSymbols/VBSConstantSymbol';
import * as data from './intellisense_data.json';
import { method } from 'bluebird';
import { CompletionTriggerKind } from 'vscode-languageserver';
import { ClientRequest } from 'http';
//import { Convert} from "./data_interface";
//

//const data = Convert.toWelcome("./intellisense_data.json");
// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: ls.IConnection = ls.createConnection(new ls.IPCMessageReader(process), new ls.IPCMessageWriter(process));

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: ls.TextDocuments = new ls.TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

/*
var wtj = require('website-to-json')
wtj.extractData('C:/Program%20Files/Vizrt/Viz3/ScriptDoc/index.html', {
  fields: ['data'],
  parse: function($) {
    return {
      title: $("title").text(),
      keywords: $('tr').text()
    }
  }
})
.then(function(res) {
  connection.console.log("Converted " + JSON.stringify(res, null, 2));
})
*/

// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
let workspaceRoot: string;
connection.onInitialize((params): ls.InitializeResult => {
	workspaceRoot = params.rootPath;
	return {
		capabilities: {
			// Tell the client that the server works in FULL text document sync mode
			textDocumentSync: documents.syncKind,
			documentSymbolProvider: true,
			// Tell the client that the server support code complete
			completionProvider:  {
				resolveProvider: true,
				triggerCharacters: [ '.' ]
			},
		}
	}
});

const pendingValidationRequests: { [uri: string]: NodeJS.Timer } = {};
const validationDelayMs = 500;

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
		if (symbolCache["builtin"] == null)
		{
			FindBuiltinSymbols();
		}
		RefreshDocumentsSymbols(textDocument.uri);
	}, validationDelayMs);
}


connection.onDidChangeWatchedFiles((changeParams: ls.DidChangeWatchedFilesParams) => {
	for (let i = 0; i < changeParams.changes.length; i++) {
		let event = changeParams.changes[i];
		connection.console.log("OnDidChangeWatchedFiles triggered!");
		switch(event.type) {
		 case ls.FileChangeType.Changed:
		 connection.console.log("changed!");
		 case ls.FileChangeType.Created:
		    connection.console.log("created!");
			RefreshDocumentsSymbols(event.uri);
			break;
		case ls.FileChangeType.Deleted:
			connection.console.log("deleted!");
			symbolCache[event.uri] = null;
			break;
		}
	}
});

// This handler provides the initial list of the completion items.
connection.onCompletion((params: ls.CompletionParams,cancelToken: ls.CancellationToken): ls.CompletionItem[] => {

	let builtinCompletions: ls.CompletionItem[] = []; 

	let line: string = documents.get(params.textDocument.uri).getText(ls.Range.create(
		ls.Position.create(params.position.line,0),
		ls.Position.create(params.position.line,params.position.character))
	);
	
	let memberStartRegex:RegExp = /[\.]?([a-zA-Z0-9\-\_]+)*[\.]$/gi;
	let regexResult = memberStartRegex.exec(line);

	if(regexResult != null && regexResult.length > 0){
		let symbols = symbolCache[params.textDocument.uri];
		let scopeSymbols = GetSymbolsOfScope(symbols, params.position);
		let items: ls.CompletionItem[] = VBSSymbol.GetLanguageServerCompletionItems(scopeSymbols);
		let builtinSymbols = symbolCache["builtin"];
		items.forEach(item => {
			if (item.label == regexResult[1])
			{
				let finalSymbols = GetBuiltInSymbolsOfScope(builtinSymbols,item.data);
				connection.console.log("Current is: " + item.label + " should spawn help for " + item.data);
				builtinCompletions = VBSSymbol.GetLanguageServerCompletionItems(finalSymbols);
			}
		});
		scopeSymbols = GetBuiltInSymbolsOfScope(builtinSymbols, "root");
		items = VBSSymbol.GetLanguageServerCompletionItems(scopeSymbols);
		items.forEach(item => {
			if (item.label == regexResult[1])
			{
				let finalSymbols = GetBuiltInSymbolsOfScope(builtinSymbols,item.data);
				connection.console.log("Current is: " + item.label + " should spawn help for " + item.label);
				builtinCompletions = VBSSymbol.GetLanguageServerCompletionItems(finalSymbols);
			}
		});
		return builtinCompletions;
	}
	else
	{
	const documentCompletions = SelectCompletionItems(params);

	builtinCompletions = SelectBuiltinCompletionItems(params);

	return documentCompletions.concat(builtinCompletions);
	}
	 
});

connection.onCompletionResolve((complItem: ls.CompletionItem): ls.CompletionItem => {
	return complItem;
});

function GetSymbolsOfDocument(uri: string) : ls.SymbolInformation[] {
	RefreshDocumentsSymbols(uri);
	return VBSSymbol.GetLanguageServerSymbols(symbolCache[uri]);
}

function SelectCompletionItems(textDocumentPosition: ls.TextDocumentPositionParams): ls.CompletionItem[] {
	let symbols = symbolCache[textDocumentPosition.textDocument.uri];
	
	if(symbols == null) {
		RefreshDocumentsSymbols(textDocumentPosition.textDocument.uri);
		symbols = symbolCache[textDocumentPosition.textDocument.uri];
		connection.console.log("Rebuilt: Symbols length: " + symbols.length.toString() + textDocumentPosition.textDocument.uri);
	}
	
	let scopeSymbols = GetSymbolsOfScope(symbols, textDocumentPosition.position);
	return VBSSymbol.GetLanguageServerCompletionItems(scopeSymbols);
}

function GetVBSSymbolTree(symbols: VBSSymbol[]) {
	// sort by start positition
	let sortedSymbols: VBSSymbol[] = symbols.sort(function(a: VBSSymbol, b: VBSSymbol){
		let diff = a.symbolRange.start.line - b.symbolRange.start.line;
		
		if(diff != 0)
			return diff;

		return a.symbolRange.start.character - b.symbolRange.start.character;
	});

	let root = new VBSSymbolTree();
	
	for (var i = 0; i < sortedSymbols.length; i++) {
		var symbol = sortedSymbols[i];
		root.InsertIntoTree(symbol);
	}

	return root;
}

function GetSymbolsOfScope(symbols: VBSSymbol[], position: ls.Position): VBSSymbol[] {
	let symbolTree = GetVBSSymbolTree(symbols);
	// bacause of hoisting we will have just a few possible scopes:
	// - file wide
	// - method of file wide
	// - class scope
	// - method or property of class scope
	// get all symbols which are accessable from here (ignore visibility in the first step)

	return symbolTree.FindDirectParent(position).GetAllParentsAndTheirDirectChildren();
}

class VBSSymbolTree {
	parent: VBSSymbolTree = null;
	children: VBSSymbolTree[] = [];
	data: VBSSymbol = null;

	public InsertIntoTree(symbol: VBSSymbol): boolean {
		if(this.data != null && !PositionInRange(this.data.symbolRange, symbol.symbolRange.start))
			return false;

		for (var i = 0; i < this.children.length; i++) {
			var symbolTree = this.children[i];
			if(symbolTree.InsertIntoTree(symbol))
				return true;
		}

		let newTreeNode = new VBSSymbolTree();
		newTreeNode.data = symbol;
		newTreeNode.parent = this;

		this.children.push(newTreeNode);

		return true;
	}

	public FindDirectParent(position: ls.Position): VBSSymbolTree {
		if(this.data != null && !PositionInRange(this.data.symbolRange, position))
			return null;
		
		for (var i = 0; i < this.children.length; i++) {
			let symbolTree = this.children[i];
			let found = symbolTree.FindDirectParent(position);
			if(found != null)
				return found;
		}

		return this;
	}

	public GetAllParentsAndTheirDirectChildren(): VBSSymbol[] {
		let symbols: VBSSymbol[];

		if(this.parent != null)
			symbols = this.parent.GetAllParentsAndTheirDirectChildren();
		else
			symbols = [];
		
		let childSymbols = this.children.map(function(symbolTree) {
			return symbolTree.data;
		});

		return symbols.concat(childSymbols);
	}
}

function PositionInRange(range: ls.Range, position: ls.Position): boolean {
	if(range.start.line > position.line)
		return false;

	if(range.end.line < position.line)
		return false;

	if(range.start.line == position.line && range.start.character >= position.character)
		return false;
		
	if(range.end.line == position.line && range.end.character <= position.character)
		return false;

	return true;
}

let symbolCache: { [id: string] : VBSSymbol[]; } = {};
function RefreshDocumentsSymbols(uri: string){
	let startTime: number = Date.now();
	let symbolsList: VBSSymbol[] = CollectSymbols(documents.get(uri));
	symbolCache[uri] = symbolsList;
	//connection.console.info("Found " + symbolsList.length + " symbols in '" + uri + "': " + (Date.now() - startTime) + " ms");
}

connection.onDocumentSymbol((docParams: ls.DocumentSymbolParams): ls.SymbolInformation[] => {
	return GetSymbolsOfDocument(docParams.textDocument.uri);
});

function CollectSymbols(document: ls.TextDocument): VBSSymbol[] {
	let symbols: Set<VBSSymbol> = new Set<VBSSymbol>();
	let lines = document.getText().split(/\r?\n/g);

	for (var i = 0; i < lines.length; i++) {
		let line = lines[i];

		let containsComment = line.indexOf("'");
		//Removes comments from symbol lines
		if(containsComment > -1) 
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

	public GetPostitionByCharacter(charIndex: number) : ls.Position {
		let internalIndex = charIndex - this.startCharacter;

		if(internalIndex < 0){
		  console.warn("WARNING: cannot resolve " + charIndex + " in me: " + JSON.stringify(this));
		  return null;
		}


		return ls.Position.create(this.startLine , internalIndex + this.startCharacter);
		
	}
}


function ReplaceBySpaces(match: string) : string {
	return " ".repeat(match.length);
}

function AddArrayToSet(s: Set<any>, a: any[]) {
	a.forEach(element => {
		s.add(element);
	});
}

function FindSymbol(statement: LineStatement, uri: string, symbols: Set<VBSSymbol>) : void {
	let newSym: VBSSymbol;
	let newSyms: VBSVariableSymbol[] = null;

	if(GetMethodStart(statement, uri)) {
		return;
	}

	newSyms = GetMethodSymbol(statement, uri);
	if(newSyms != null && newSyms.length != 0) {
		AddArrayToSet(symbols, newSyms);
		return;
	}

	if(GetPropertyStart(statement, uri))
		return;

	newSyms = GetPropertySymbol(statement, uri);;
	if(newSyms != null && newSyms.length != 0) {
		AddArrayToSet(symbols, newSyms);
		return;
	}

	if(GetStructureStart(statement, uri))
		return;

	newSym = GetStructureSymbol(statement, uri);
	if(newSym != null) {
		symbols.add(newSym);
		return;
	}

	newSym = GetMemberSymbol(statement, uri);
	if(newSym != null) {
		symbols.add(newSym);
		return;
	}

	newSyms = GetVariableSymbol(statement, uri);
	if(newSyms != null && newSyms.length != 0) {
		AddArrayToSet(symbols, newSyms);
		return;
	}

	newSym = GetConstantSymbol(statement, uri);
	if(newSym != null) {
		symbols.add(newSym);
		return;
	}
}

let openStructureName : string = null;
let openStructureStart : ls.Position = ls.Position.create(-1, -1);

class OpenMethod {
	visibility: string;
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

	let rex:RegExp = /^[ \t]*?(function|sub)[ \t]+([a-zA-Z0-9\-\_]+)[ \t]*(\(([a-zA-Z0-9\[\]\_\-, \t(\(\))]*)\))*[ \t]*(as)*[ \t]*([a-zA-Z0-9\-\_]*)?[ \t]*$/gi;

	let regexResult = rex.exec(line);

	if(regexResult == null || regexResult.length < 4)
		return;

	if(openMethod == null) {
		let leadingSpaces = GetNumberOfFrontSpaces(line);
		let preLength = leadingSpaces + regexResult.index;

		for (var i = 1; i < 3; i++) {
			var resElement = regexResult[i];
			if(resElement != null)
				preLength += resElement.length;
		}

		openMethod = {
			visibility: "",
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
		
		if(openMethod.args == null)
			openMethod.args = "";

		return true;
	} else {
		// ERROR!!! I expected "end function|sub"!
		console.error("ERROR - line " + statement.startLine + " at " + statement.startCharacter + ": 'end " + openMethod.type + "' expected!");
	}

	return false;
}

function GetMethodSymbol(statement: LineStatement, uri: string) : VBSSymbol[] {
	let line: string = statement.line;

	let classEndRegex:RegExp = /^[ \t]*end[ \t]+(function|sub)?[ \t]*$/gi;

	let regexResult = classEndRegex.exec(line);

	if(regexResult == null || regexResult.length < 2)
		return null;

	let type = regexResult[1];

	if(openMethod == null) {
		// ERROR!!! I cannot close any method!
		console.error("ERROR - line " + statement.startLine + " at " + statement.startCharacter + ": There is no " + type + " to end!");
		return null;
	}

	if(type.toLowerCase() != openMethod.type.toLowerCase()) {
		// ERROR!!! I expected end function|sub and not sub|function!
		// show the user the error and then go on like it was the right type!
		console.error("ERROR - line " + statement.startLine + " at " + statement.startCharacter + ": 'end " + openMethod.type + "' expected!");
	}

	let range: ls.Range = ls.Range.create(openMethod.startPosition, statement.GetPostitionByCharacter(GetNumberOfFrontSpaces(line) + regexResult[0].trim().length))
	
	let symbol: VBSMethodSymbol = new VBSMethodSymbol();
	symbol.visibility = openMethod.visibility;
	symbol.type = openMethod.type;
	symbol.name = openMethod.name;
	symbol.args = openMethod.args;
	symbol.nameLocation = openMethod.nameLocation;
	symbol.parentName = openStructureName;
	symbol.symbolRange = range;

	let parametersSymbol = GetParameterSymbols(openMethod.args, openMethod.argsIndex, openMethod.statement, uri);

	openMethod = null;

	//return [symbol];
	return parametersSymbol.concat(symbol);
}

function ReplaceAll(target: string, search: string, replacement: string): string {
    return target.replace(new RegExp(search, 'g'), replacement);
};

function GetParameterSymbols(args: string, argsIndex: number, statement: LineStatement, uri: string): VBSVariableSymbol[] {
	let symbols: VBSVariableSymbol[] = [];

	if(args == null || args == "")
		return symbols;

	let argsSplitted: string[] = args.split(',');

	for (let i = 0; i < argsSplitted.length; i++) {
		let arg = argsSplitted[i];
		
		let splittedByValByRefName = ReplaceAll(ReplaceAll(arg, "\t", " "), "  ", " ").trim().split(" ");

		let varSymbol:VBSVariableSymbol = new VBSVariableSymbol();
		varSymbol.args = "";
		varSymbol.type = "";
		varSymbol.visibility = "";

		if(splittedByValByRefName.length == 3){
			varSymbol.name = splittedByValByRefName[0].trim();
			varSymbol.type = splittedByValByRefName[2].trim();
		}
		else if(splittedByValByRefName.length > 3)
		{
			// ByVal or ByRef
			varSymbol.type = splittedByValByRefName[1].trim();
			varSymbol.name = splittedByValByRefName[3].trim();
		}

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
		if(char == " " || char == "\t")
			counter++;
		else
			break;
	}

	return counter;
}

class OpenProperty {
	visibility: string;
	type: string;
	name: string;
	argsIndex: number;
	args: string;
	startPosition: ls.Position;
	nameLocation: ls.Location;
	statement: LineStatement;
}

let openProperty: OpenProperty = null;

function GetPropertyStart(statement: LineStatement, uri: string) : boolean {
	let line: string = statement.line;

	let propertyStartRegex:RegExp = /^[ \t]*(public[ \t]+|private[ \t]+)?(default[ \t]+)?(property[ \t]+)(let[ \t]+|set[ \t]+|get[ \t]+)([a-zA-Z0-9\-\_]+)([ \t]*)(\(([a-zA-Z0-9\_\-, \t(\(\))]*)\))?[ \t]*$/gi;
	let regexResult = propertyStartRegex.exec(line);

	if(regexResult == null || regexResult.length < 6)
		return null;

	let leadingSpaces = GetNumberOfFrontSpaces(line);
	let preLength = leadingSpaces + regexResult.index;
	
	for (var i = 1; i < 7; i++) {
		var resElement = regexResult[i];
		if(resElement != null)
			preLength += resElement.length;
	}

	if(openProperty == null) {
		openProperty = {
			visibility: regexResult[1],
			type: regexResult[4],
			name: regexResult[5],
			argsIndex: preLength + 1,
			args: regexResult[8],
			startPosition: statement.GetPostitionByCharacter(leadingSpaces),
			nameLocation: ls.Location.create(uri, ls.Range.create(
				statement.GetPostitionByCharacter(line.indexOf(regexResult[5])),
				statement.GetPostitionByCharacter(line.indexOf(regexResult[5]) + regexResult[5].length))
			),
			statement: statement
		};

		if(openProperty.args == null)
			openProperty.args = "";

		return true;
	} else {
		// ERROR!!! I expected "end function|sub"!
		console.error("ERROR - line " + statement.startLine + " at " + statement.startCharacter + ": 'end property' expected!");
	}

	return false;
}

function GetPropertySymbol(statement: LineStatement, uri: string) : VBSSymbol[] {
	let line: string = statement.line;

	let classEndRegex:RegExp = /^[ \t]*end[ \t]+property[ \t]*$/gi;

	let regexResult = classEndRegex.exec(line);

	if(regexResult == null || regexResult.length < 1)
		return null;

	if(openProperty == null) {
		// ERROR!!! I cannot close any property!
		console.error("ERROR - line " + statement.startLine + " at " + statement.startCharacter + ": There is no property to end!");
		return null;
	}

	// range of the whole definition
	let range: ls.Range = ls.Range.create(
		openProperty.startPosition, 
		statement.GetPostitionByCharacter(GetNumberOfFrontSpaces(line) + regexResult[0].trim().length)
	);
	
	let symbol = new VBSPropertySymbol();
	symbol.visibility = "";
	symbol.type = openProperty.type;
	symbol.name = openProperty.name;
	symbol.args = openProperty.args;
	symbol.symbolRange = range;
	symbol.nameLocation = openProperty.nameLocation;
	symbol.parentName = openStructureName;
	symbol.symbolRange = range;

	let parametersSymbol = GetParameterSymbols(openProperty.args, openProperty.argsIndex, openProperty.statement, uri);

	openProperty = null;

	return parametersSymbol.concat(symbol);
}

function GetMemberSymbol(statement: LineStatement, uri: string) : VBSMemberSymbol {
	let line: string = statement.line;

	let memberStartRegex:RegExp = /^[ \t]*([a-zA-Z0-9\-\_\,]+)[ \t]+as[ \t]+([a-zA-Z0-9\-\_\,\[\]]+).*$/gi;
	let regexResult = memberStartRegex.exec(line);

	if(regexResult == null || regexResult.length < 3)
		return null;

	let visibility = "";
	let name = regexResult[1];
	let type = regexResult[2];
	let intendention = GetNumberOfFrontSpaces(line);
	let nameStartIndex = line.indexOf(line);

	let range: ls.Range = ls.Range.create(
		statement.GetPostitionByCharacter(intendention), 
		statement.GetPostitionByCharacter(intendention + regexResult[0].trim().length)
	);
	
	let symbol: VBSMemberSymbol = new VBSMemberSymbol();
	symbol.visibility = visibility;
	symbol.type = type
	symbol.name = name;
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
	return vars.split(',').map(function(s) { return s.trim(); });
}

function GetVariableSymbol(statement: LineStatement, uri: string) : VBSVariableSymbol[] {
	let line: string = statement.line;

	let variableSymbols: VBSVariableSymbol[] = [];
	let memberStartRegex:RegExp = /^[ \t]*dim[ \t]+([a-zA-Z0-9\-\_\,]+)[ \t]+as[ \t]+([a-zA-Z0-9\-\_\,\[\]]+).*$/gi;
	let regexResult = memberStartRegex.exec(line);

	if(regexResult == null || regexResult.length < 3)
		return null;

	// (dim[ \t]+)
	let visibility = "";
	let variables = GetVariableNamesFromList(regexResult[1]);
	let intendention = GetNumberOfFrontSpaces(line);
	let nameStartIndex = line.indexOf(line);
	let firstElementOffset = visibility.length;
	let parentName: string = "";
	let type: string = regexResult[2]

	if(openStructureName != null)
		parentName = openStructureName;

	if(openMethod != null)
		parentName = openMethod.name;

	if(openProperty != null)
		parentName = openProperty.name;

	for (let i = 0; i < variables.length; i++) {
		let varName = variables[i];
		let symbol: VBSVariableSymbol = new VBSVariableSymbol();
		symbol.visibility = "";
		symbol.type = type;
		symbol.name = varName;
		symbol.args = "";
		symbol.nameLocation = ls.Location.create(uri, 
			GetNameRange(statement, varName )
		);
		
		symbol.symbolRange = ls.Range.create(
			ls.Position.create(symbol.nameLocation.range.start.line, symbol.nameLocation.range.start.character - firstElementOffset), 
			ls.Position.create(symbol.nameLocation.range.end.line, symbol.nameLocation.range.end.character)
		);
		
		firstElementOffset = 0;
		symbol.parentName = parentName;
		
		variableSymbols.push(symbol);
	}

	return variableSymbols;
}

function GetNameRange(statement: LineStatement, name: string): ls.Range {
	let line: string = statement.line;

	let findVariableName = new RegExp("(" + name.trim() + "[ \t]*)","gi");
	let matches = findVariableName.exec(line);

	let rng = ls.Range.create(
		statement.GetPostitionByCharacter(matches.index),
		statement.GetPostitionByCharacter(matches.index + name.trim().length)
	);

	return rng;
}

function GetConstantSymbol(statement: LineStatement, uri: string) : VBSConstantSymbol {
	if(openMethod != null || openProperty != null)
		return null;

	let line: string = statement.line;

	let memberStartRegex:RegExp = /^[ \t]*(public[ \t]+|private[ \t]+)?const[ \t]+([a-zA-Z0-9\-\_]+)[ \t]*\=.*$/gi;
	let regexResult = memberStartRegex.exec(line);

	if(regexResult == null || regexResult.length < 3)
		return null;

	let visibility = regexResult[1];
	if(visibility != null)
		visibility = visibility.trim();

	let name = regexResult[2].trim();
	let intendention = GetNumberOfFrontSpaces(line);
	let nameStartIndex = line.indexOf(line);

	let range: ls.Range = ls.Range.create(
		statement.GetPostitionByCharacter(intendention), 
		statement.GetPostitionByCharacter(intendention + regexResult[0].trim().length)
	);
	
	let parentName: string = "";
	
	if(openStructureName != null)
		parentName = openStructureName;

	if(openMethod != null)
		parentName = openMethod.name;

	if(openProperty != null)
		parentName = openProperty.name;

	let symbol: VBSConstantSymbol = new VBSConstantSymbol();
	symbol.visibility = visibility;
	symbol.type = "";
	symbol.name = name;
	symbol.args = "";
	symbol.symbolRange = range;
	symbol.nameLocation = ls.Location.create(uri, 
		ls.Range.create(
			statement.GetPostitionByCharacter(nameStartIndex),
			statement.GetPostitionByCharacter(nameStartIndex + name.length)
		)
	);
	symbol.parentName = parentName;

	return symbol;
}

function GetStructureStart(statement: LineStatement, uri: string) : boolean {
	let line: string = statement.line;

	let classStartRegex:RegExp = /^[ \t]*structure[ \t]+([a-zA-Z0-9\-\_]+)[ \t]*$/gi;
	let regexResult = classStartRegex.exec(line);

	if(regexResult == null || regexResult.length < 2)
		return false;

	let name = regexResult[1];
	openStructureName = name;
	openStructureStart = statement.GetPostitionByCharacter(GetNumberOfFrontSpaces(line));

	return true;
}

function GetStructureSymbol(statement: LineStatement, uri: string) : VBSClassSymbol {
	let line: string = statement.line;

	let classEndRegex:RegExp = /^[ \t]*end[ \t]+structure[ \t]*$/gi;

	if(openStructureName == null)
		return null;
	
	let regexResult = classEndRegex.exec(line);

	if(regexResult == null || regexResult.length < 1)
		return null;

	if(openMethod != null) {
		// ERROR! expected to close method before!
		console.error("ERROR - Structure - line " + statement.startLine + " at " + statement.startCharacter + ": 'end " + openMethod.type + "' expected!");
	}

	if(openProperty != null) {
		// ERROR! expected to close property before!
		console.error("ERROR - Structure - line " + statement.startLine + " at " + statement.startCharacter + ": 'end property' expected!");
	}

	let range: ls.Range = ls.Range.create(openStructureStart, statement.GetPostitionByCharacter(regexResult[0].length))
	let symbol: VBSClassSymbol = new VBSClassSymbol();
	symbol.name = openStructureName;
	symbol.nameLocation = ls.Location.create(uri, 
		ls.Range.create(openStructureStart, 
			ls.Position.create(openStructureStart.line, openStructureStart.character + openStructureName.length)
		)
	);
	symbol.symbolRange = range;
	//let symbol: ls.SymbolInformation = ls.SymbolInformation.create(openClassName, ls.SymbolKind.Class, range, uri);

	openStructureName = null;
	openStructureStart = ls.Position.create(-1, -1);

	return symbol;
}

function FindBuiltinSymbols() {
	let symbols: VBSSymbol[] = [];
	let startTime: number = Date.now();

	data.intellisense.scopes.scope.forEach(element => {
		if (element.name == "Global Procedures")
		{
			element.methods.forEach(submethod => {
				let symbol: VBSMethodSymbol = new VBSMethodSymbol();
				symbol.visibility = "";
				symbol.type = submethod.type;
				symbol.name = submethod.name;
				symbol.args = submethod.code_completion_hint;
				symbol.parentName = "root";
				symbols.push(symbol);
			});
		}
		else
		{
			let symbol: VBSClassSymbol = new VBSClassSymbol();
			symbol.name = element.name;
			symbol.parentName = "root";
			symbol.type = element.name;
			symbols.push(symbol);
			
			element.methods.forEach(submethod => {
				let symbol: VBSMethodSymbol = new VBSMethodSymbol();
				symbol.visibility = "";
				symbol.type = submethod.type;
				symbol.name = submethod.name;
				symbol.args = submethod.code_completion_hint;
				//connection.console.log("Parent name for " + submethod.name + " is " + element.name);
				symbol.parentName = element.name;
				symbols.push(symbol);
			});
			element.properties.forEach(properties => {
				let symbol: VBSPropertySymbol = new VBSPropertySymbol();
				symbol.visibility = "";
				symbol.type = properties.type;
				symbol.name = properties.name;
				symbol.args = properties.code_completion_hint;
				//connection.console.log("Parent name for " + properties.name + " is " + element.name);
				symbol.parentName = element.name;
				symbols.push(symbol);
			});

		}
	});

	symbolCache["builtin"] = symbols;
}


function GetBuiltInSymbolsOfScope(symbols: VBSSymbol[], type: string): VBSSymbol[] {
	let scopeSymbols: VBSSymbol[] = [];
	symbols.forEach(symbol => {
		//connection.console.log("Parent name: " + symbol.parentName + " type: " + type);
		if(symbol.parentName == type)
		{
			connection.console.log("Name: " + symbol.name + " Parent: " + symbol.parentName);
			scopeSymbols.push(symbol);
		}
	});

	return scopeSymbols;
}


function SelectBuiltinCompletionItems(textDocumentPosition: ls.TextDocumentPositionParams): ls.CompletionItem[]{
  let symbols = symbolCache["builtin"];
    
  if(symbols == null) {
		FindBuiltinSymbols();
		symbols = symbolCache["builtin"];
		connection.console.log("Rebuilt: Builtin symbols length: " + symbols.length.toString());
	}
	let scopeSymbols = GetBuiltInSymbolsOfScope(symbols, "root");
	return VBSSymbol.GetLanguageServerCompletionItems(scopeSymbols);
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
	connection.console.log(`${params.textDocument.uri} closed.`);
});



// Listen on the connection
connection.listen();