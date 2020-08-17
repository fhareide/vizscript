/* --------------------------------------------------------------------------------------------
 * Copyright (c) Andreas Lenzen. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as ls from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VizSymbol } from "./vizsymbol";
import * as data from './viz_completions.json';
import * as vizevent from './vizevent_completions.json';



// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: ls.IConnection = ls.createConnection(new ls.IPCMessageReader(process), new ls.IPCMessageWriter(process));

// Create a simple text document manager. The text document manager
// supports full document sync only

let documents = new ls.TextDocuments(TextDocument);
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

let hasConfigurationCapability: boolean = false;

// After the server has started the client sends an initialize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilities.
let workspaceRoot: string;
connection.onInitialize((params): ls.InitializeResult => {
	let capabilities = params.capabilities;
	
	// Does the client support the `workspace/configuration` request?
	// If not, we will fall back using global settings
	hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);

	workspaceRoot = params.rootPath;
	//Initialize built in symbols
	if (symbolCache["builtin"] == null) GetBuiltinSymbols();
	if (symbolCache["builtin_events"] == null) GetVizEvents();



	return {
		capabilities: {
			textDocumentSync: ls.TextDocumentSyncKind.Full,
			documentSymbolProvider: true,
			signatureHelpProvider: {
				triggerCharacters: [ '('],
			},
			// Tell the client that the server support code complete
			definitionProvider: true,
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: ['.']
			},
		}
	
	}
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(
			ls.DidChangeConfigurationNotification.type,
			undefined
		);
	}
});

// Settings interface
interface VizScriptSettings {
	enableAutoComplete: boolean;
	enableSignatureHelp: boolean;
	enableDefinition: boolean;
	enableGlobalProcedureSnippets: boolean;
	compiler: VizScriptCompilerSettings;
}

interface VizScriptCompilerSettings {
	hostName: string;
	hostPort: number;
	liveSyntaxChecking: boolean;
}


// Cache the settings of all open documents
let documentSettings: Map<string, Thenable<VizScriptSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	}
	

	// Revalidate all open text documents
	documents.all().forEach(cacheConfiguration);
	GetBuiltinSymbols();
});

const pendingValidationRequests: { [uri: string]: NodeJS.Timer } = {};
const validationDelayMs = 500;

let documentUri: string;
let scriptType: string = "";

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change: ls.TextDocumentChangeEvent<TextDocument>) => {
	//connection.console.log("Document changed. version: " + change.document.version.toString());
	documentUri = change.document.uri;
	triggerValidation(change.document);
	ClearDiagnostics(documentUri);
});

function getDocumentSettings(resource: string): Thenable<VizScriptSettings> {
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: "vizscript"
		});
		documentSettings.set(resource, result);
	}
	return result;
}

let settings: VizScriptSettings;


async function cacheConfiguration(textDocument: TextDocument): Promise<void> {
	settings = await getDocumentSettings(textDocument.uri);
}

// a document has opened: cache configuration
documents.onDidOpen(event => {
	documentUri = event.document.uri;
	cacheConfiguration(event.document);
});

// a document has closed: clear all diagnostics
documents.onDidClose(event => {
	cleanPendingValidation(event.document);
	connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	documentSettings.delete(event.document.uri);
});

let sceneId = "";
let containerId = "";
let scriptId = "";


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
		SetScriptType(textDocument.languageId);
		if(settings != null){
			if (settings.compiler.liveSyntaxChecking){
				connection.sendNotification('requestCompile');
			}
		}
	}, validationDelayMs);
}

function getWordAt(str, pos) {

    // Perform type conversions.
    str = String(str);

    // Search for the word's beginning and end.
    var left = str.slice(0, pos + 1).search(/[a-zA-Z0-9\-\_]+$/),
        right = str.slice(pos).search(/[\s\.\(\)]/);

    // The last word in the string is a special case.
    if (right < 0) {
        return str.slice(left);
    }

    // Return the word, using the located bounds to extract it from the string.
    return str.slice(left, right + pos);

}

function getLineAt(str, pos, isSignatureHelp) {

    // Perform type conversions.
	str = String(str);
	if(str == "")return "";
	str = str.trim();

	var line = str.slice(0, pos + 1);

	let matches = [];
	let dotResult = [];

	

	let bracketRanges: ls.Range[] = getBracketRanges(line); //Remove content of closed brackets
	let lastRange: ls.Range = ls.Range.create(ls.Position.create(-1,-1),ls.Position.create(-1,-1));
	if(bracketRanges.length != 0){
		for (let i = bracketRanges.length - 1; i >= 0; i--) {
			const element = bracketRanges[i];
			if(!PositionInRange(lastRange, element.start)){
				//connection.console.log("Range: " + element.start.character + " " + element.end.character);
				var leftstr = line.slice(0,element.start.character+1);
				var rightstr = line.slice(element.end.character);
				line = leftstr + rightstr;
				//connection.console.log("Line: " + line);
				lastRange = element;
			}	
		  }		
	}

	let openBracketPos = getOpenBracketPosition(line); //If inside open bracket we should slice away everything before the bracket
	if(openBracketPos > 0){
		if(!isSignatureHelp){
			line = line.slice(openBracketPos+1);
		}
	}

	let result = GetRegexResult(line, /[\=|\>]((.*)+)$/gi); //Split on "=|>"

	if (result != null){
		if( result[1] != undefined){
			line = result[1];
		}
	}

	result = GetRegexResult(line, /[\<]((.*)+)$/gi); //Split on "<"

	if (result != null){
		if( result[1] != undefined){
			line = result[1];
		}
	}

	let memberStartRegex: RegExp = /([^\.]+)([\.])*/gi; //Split on "."

	//connection.console.log("Line: " + line);

	while (matches = memberStartRegex.exec(line)) {
		dotResult.push(matches);   
	}

	let regexResult = [];
	let regexString: RegExp ;
	
	let cleanString: string = "";
	if(dotResult.length != 0){
		dotResult.forEach(result => {
			let tmpLine = result[1];
			regexString = /(.*)?[\[](.*?)[\]]$/gi;
			regexResult = regexString.exec(result[1]);
			if(regexResult != null){
				tmpLine = regexResult[1] + "[]"; // Keeping square brackets to be able to differ between array and array[type]
			}
			regexString = /(.*)?[\(](.*?)[\)]$/gi;
			regexResult = null;
			regexResult = regexString.exec(tmpLine);
			if(regexResult != null){
				tmpLine = regexResult[1]; // Removing parantheses for now. Do not think we need them
			}
			
			if (result[2] != undefined){
				cleanString += tmpLine + result[2];
			}else{
				cleanString += tmpLine;
			}
		});
	}
	

	
    // Search for the sentence beginning and end.
	var left = cleanString.slice(0, pos + 1).search(/[^\s]+$/)
    var right = cleanString.slice(pos).search(/[\s\.\(]/);

	// The last word in the string is a special case.
	let finalString = "";
    if (right < 0) {
      finalString =  cleanString.slice(left);
	} else {
	  finalString = cleanString.slice(left, right + pos);
	}

	if(!isSignatureHelp){ //Only do this if it is not a Signature Help
		regexResult = null;	
		regexString = /(.*\()([^\)]*)$/gi;
		regexResult = regexString.exec(finalString);
		if(regexResult != null){
			finalString = regexResult[2]; //  Removing everything before open parantheses at the end of a line (abc.fsdfsd() but not closed parantheses(fsd())
		}
	}

	regexResult = null;	
	regexString = /(.*\[)([^\]]*)$/gi;
	regexResult = regexString.exec(finalString);

	if(regexResult != null){
		finalString = regexResult[2]; //  Removing everything before open brackets at the end of a line (abc.fsdfsd[) but not closed brackets(fsd[])
	}

	//connection.console.log("Final: " + finalString);

    return finalString;


	
}

function getOpenBracketPosition(mystring) {
	let stack = [];
	let bracketpos = [];
    let map = {
        '(': ')',
        '[': ']',
        '{': '}'
    }

    for (let i = 0; i < mystring.length; i++) {

        // If character is an opening brace add it to a stack
        if (mystring[i] === '(' || mystring[i] === '{' || mystring[i] === '[' ) {
			stack.push(mystring[i]);
			bracketpos.push(i);
        }
        //  If that character is a closing brace, pop from the stack, which will also reduce the length of the stack each time a closing bracket is encountered.
        else if (mystring[i] === ')' || mystring[i] === '}' || mystring[i] === ']' ) {
			let last = stack.pop();
			bracketpos.pop();

            //If the popped element from the stack, which is the last opening brace doesn’t match the corresponding closing brace in the map, then return false
            if (mystring[i] !== map[last]) {
				return -1};
        }
    }
    // By the completion of the for loop after checking all the brackets of the str, at the end, if the stack is not empty then return last open bracket pos
        if (stack.length !== 0) {
			//connection.console.log("Open bracket pos: " + bracketpos[stack.length-1]);
			return bracketpos[stack.length-1]
		};

    return -1;
}

function getBracketRanges(mystring) {
	let stack = [];
	let bracketpos = [];
	let bracketRanges = [];
    let map = {
        '(': ')',
        '[': ']',
        '{': '}'
    }

    for (let i = 0; i < mystring.length; i++) {

        // If character is an opening brace add it to a stack
        if (mystring[i] === '(' || mystring[i] === '{' || mystring[i] === '[' ) {
			stack.push(mystring[i]);
			bracketpos.push(i);
        }
        //  If that character is a closing brace, pop from the stack, which will also reduce the length of the stack each time a closing bracket is encountered.
        else if (mystring[i] === ')' || mystring[i] === '}' || mystring[i] === ']' ) {
			let last = stack.pop();
			let lastpos = bracketpos.pop();

            //If the popped element from the stack, matches the corresponding closing brace in the map, then add range to array
            if (mystring[i] === map[last]) {
				bracketRanges.push(ls.Range.create(
					ls.Position.create(0, lastpos),
					ls.Position.create(0, i))
				);
			}
		}
    }

    return bracketRanges;
}




connection.onSignatureHelp((params: ls.SignatureHelpParams,cancelToken: ls.CancellationToken) : ls.SignatureHelp => {
	if(settings != null){ if (!settings.enableSignatureHelp) return;}
	let line: string = documents.get(params.textDocument.uri).getText(ls.Range.create(
		ls.Position.create(params.position.line, 0),
		ls.Position.create(params.position.line, params.position.character))
	);

	let signHelp: ls.SignatureHelp = {
		signatures: [],
		activeParameter: 0,
		activeSignature: 0
	}

	let activeSignature =0;

	if (line.length < 2)return;
	let regexResult = [];

	let signatureRegex: RegExp = /^[ \t]*(function|sub)+[ \t]+([a-zA-Z0-9\-\_]+)+[ \t]*(\()+$/gi;

	regexResult = signatureRegex.exec(line);
	if (regexResult != null) return null; //Return here since we don't want to provide signatureHelp while writing a function or sub.
	
	let lineAt = getLineAt(line, params.position.character, true);

	if(params.context.activeSignatureHelp != undefined){
		activeSignature = params.context.activeSignatureHelp.activeSignature;
	}

	signatureRegex = /[\.]?([^\.\ ]+)[\.\(]+/gi; // Get signature parts

	let matches = [];
	regexResult = [];
	
	let noOfMatches = 0;

	while (matches = signatureRegex.exec(lineAt)) {
		let tmpline = matches[1].replace(/\([^()]*\)/g, '') // Remove parantheses
		regexResult.push(tmpline);   
	}
	noOfMatches = regexResult.length;

	matches = [];
	let regexResult2 = [];
	let noOfCommas = 0;
	
	signatureRegex = /([,]+)/gi; // Split on commas
	while (matches = signatureRegex.exec(lineAt)) {
		regexResult2.push(matches[1]);   
	}
	noOfCommas = regexResult2.length;

	let item = GetItemForSignature(regexResult[noOfMatches-1],noOfMatches,regexResult,params.position);

	if(item == null) return null;
	signHelp.signatures = [];

	let signature = item.signatureInfo;
	if(signature != null){
		if ((signature.documentation != "") || (signature.parameters.length != 0) || (item.overloads != [])) {
			signHelp.signatures.push(signature);
		}
	}

	if(item.overloads != []){
		item.overloads.forEach(overload => {		
			if (overload != null){
				if ((overload.documentation != undefined) || (overload.parameters != [])){
					signHelp.signatures.push(overload);
				}
			  
			}
		});
	}

	signHelp.activeSignature = activeSignature;
	signHelp.activeParameter = noOfCommas;
	
	return signHelp;
    
});


function GenerateSignatureHelp(hint: string, documentation: string): ls.SignatureInformation {
	let regexResult3 = [];

	let memberStartRegex2: RegExp = /^([^.]*)\((.*?)\)([^.]*)$/gi;
	
	if(hint == "")return null;
	regexResult3 = memberStartRegex2.exec(hint);
	//connection.console.info("Hint length: " + regexResult3.length);
	if( regexResult3 == null) return null;
	if (regexResult3.length < 4) return null;
	

	//connection.console.info("Hint: " + regexResult3[1]);
	
	let signature: ls.SignatureInformation = {
		label: '',
		documentation: documentation,
		parameters: []
	};

	let markdown: ls.MarkupContent = {
		kind: ls.MarkupKind.Markdown,
		value: [
			'## Header',
			'Some text',
			'```viz',
			hint,
			'```'
			].join('\n')
	};
	
	var paramStrings = regexResult3[2].split(',');

	signature.label += regexResult3[1] +"(";
	if (paramStrings.length != 0){
		for (var i = 0; i < paramStrings.length; i++) {
			let label = paramStrings[i].trim();
	
			let parameter: ls.ParameterInformation = {
				label: label,
				documentation: ""
			};
			signature.label += label;
			signature.parameters!.push(parameter);
			if (i < paramStrings.length - 1) {
				signature.label += ",";
			}
		}
	}

	signature.label += ")" + regexResult3[3];

	return signature;
}

function GenerateSnippetString(hint: string, documentation: string): string {
	let regexResult3 = [];

	let memberStartRegex2: RegExp = /^[ \t]*(function|sub)?[ \t]*([^.]*)\((.*?)\)([^.]*)$/gi;
	
	if(hint == "")return null;
	regexResult3 = memberStartRegex2.exec(hint);
	//connection.console.info("Hint length: " + regexResult3.length);
	if( regexResult3 == null) return null;
	if (regexResult3.length < 4) return null;
	

	//connection.console.info("Hint: " + regexResult3[1]);
	
	let snippetString = "";

	if(regexResult3[3] == "") return "";
	
	var paramStrings = regexResult3[3].split(',');
	if(paramStrings.length == 0) return "";
	snippetString += regexResult3[2] +"(";
	if (paramStrings.length != 0){
		for (var i = 0; i < paramStrings.length; i++) {
			let label: string = paramStrings[i].trim();

			var paramParts = label.toLowerCase().split('as');
			if(paramParts.length == 0) return "";
			if(paramParts[1].trim() == "string"){
				snippetString += "\"${" + (i+1) + ":" + label + "}\"";
			}else{
				snippetString += "${" + (i+1) + ":" + label + "}";
			}
	
			if (i < paramStrings.length - 1) {
				snippetString += ",";
			}
		}
	}

	snippetString += ")"

	return snippetString;
}

connection.onDefinition((params: ls.TextDocumentPositionParams, cancelToken: ls.CancellationToken): ls.Definition => {
	if(settings != null){ if (!settings.enableDefinition) return;}
	let line: string = documents.get(params.textDocument.uri).getText(ls.Range.create(
		ls.Position.create(params.position.line, 0),
		ls.Position.create(params.position.line, 50000))
	);

	if (line.length < 2)return;

	let word = getWordAt(line, params.position.character);

	let item = GetSymbolByName(word,params.position);
	if(item == null)return null;
	if(item.symbolRange == null)return null;
	if(PositionInRange(item.symbolRange, params.position))return null;

	let DefinitionItem: ls.Definition = {
		range: item.symbolRange,
		uri: params.textDocument.uri
	}

	return DefinitionItem;
});

function GetRegexResult(line: string, regex: RegExp): string[] {
	let RegexString: RegExp = regex;
	return RegexString.exec(line);
}

connection.onCompletion((params: ls.CompletionParams, cancelToken: ls.CancellationToken): ls.CompletionItem[] => {
	if(settings != null){ if (!settings.enableAutoComplete) return;}
	let suggestions: ls.CompletionItem[] = [];
	let documentCompletions: ls.CompletionItem[] = [];
	let rootCompletions: ls.CompletionItem[] = [];


	// Gets current line
	let line: string = documents.get(params.textDocument.uri).getText(ls.Range.create(
		ls.Position.create(params.position.line, 0),
		ls.Position.create(params.position.line, params.position.character))
	);
	
	if (GetRegexResult(line, /^[ \t]*dim[ \t]+([a-zA-Z0-9\-\_\,]+)[ \t]*([as]+)?$/gi) != null) return;// No sugggestions when declaring variables
	if (GetRegexResult(line, /^[ \t]*function[ \t]+([a-zA-Z0-9\-\_\,]+)$/gi) != null) return;// No suggestions when declaring functions
	if (GetRegexResult(line, /^[ \t]*end[ \t]+([a-zA-Z0-9\-\_\,]*)$/gi) != null) return;// No suggestions for ending sub or function
	if (GetRegexResult(line, /^[if|elseif]*(.*)[ \t]+[then]+$/gi) != null) return;// No suggestions at end of if sentence
	
	if (GetRegexResult(line, /^[ \t]*sub[ \t]+On?$/gi) != null) return SelectBuiltinEventCompletionItems();// Only event suggestions when declaring submethod

	if (GetRegexResult(line, /\=[\s]*([^\=\.\)]+)$/gi) != null) // Suggestions after "="
	{
		documentCompletions = SelectCompletionItems(params);
		suggestions = documentCompletions.concat(SelectBuiltinGlobalCompletionItems());			
		suggestions = suggestions.concat(SelectBuiltinRootCompletionItems());
		return suggestions;
	} 


	let lineAt = getLineAt(line, params.position.character,false);

	let matches = [];
	let regexResult = [];
	let noOfMatches = 0;

	let memberStartRegex: RegExp = /[\.]?([^\.\ ]+)[\.]+/gi;

	while (matches = memberStartRegex.exec(lineAt)) {
		let tmpline = matches[1].replace(/\([^()]*\)/g, '')
		regexResult.push(tmpline);   
	}
	noOfMatches = regexResult.length;

	if (noOfMatches != 0) {
		if (regexResult != null && regexResult.length > 0) {
			let item = GetItemType(noOfMatches,regexResult,params.position);
			if (item != null) {
				suggestions = [];
				suggestions = item.GetLsChildrenItems();;
			} else {
				suggestions = []	  
			}
		}
	} else {
		let memberStartRegex: RegExp =/([ \t]*as[ \t]+\S*)$(?!.*\1)/gi;
		memberStartRegex.lastIndex = 0;
		regexResult = memberStartRegex.exec(line);
		let symbols = symbolCache[params.textDocument.uri];
		if (regexResult != null) {
			documentCompletions = [];
			let finalSymbols = [];
			if(symbols != []){
				symbols.forEach(item => {
					if (item.kind == ls.CompletionItemKind.Struct) {
						finalSymbols.push(item);
					}
				});
				documentCompletions = VizSymbol.GetLanguageServerCompletionItems(finalSymbols);
			}
			suggestions = documentCompletions.concat(SelectBuiltinCompletionItems());
			suggestions = suggestions.concat(SelectBuiltinRootCompletionItems());
			suggestions = suggestions.concat(SelectBuiltinRootThisCompletionItems());
		} else {
			documentCompletions = SelectCompletionItems(params);
			suggestions = documentCompletions.concat(SelectBuiltinGlobalCompletionItems());			
			suggestions = suggestions.concat(SelectBuiltinRootCompletionItems());
			suggestions = suggestions.concat(SelectBuiltinRootThisCompletionItems());
		}
	}

	return suggestions;

});

function GetItemType(currentIdx: number,regexResult: any[],position: ls.Position): VizSymbol {
	let children: VizSymbol[] = null;
	let item: VizSymbol = null;
	for (var i = 0; i < currentIdx; i++) {
		if(children == null){
			item = GetSymbolByName(regexResult[i], position);// Need to add check for Array or Array[Type]
			if(item != null){
				children = item.children;
				if(children.length < 1){
					let innerItem = GetSymbolByName(item.type, position);
					if(innerItem != null){
						children = innerItem.children;
						item = innerItem;
					}
				}
			}
			
		}else{
			let outerType = GetSymbolTypeInChildren(regexResult[i],children);
			//let outerItem = GetSymbolInChildren(regexResult[i],children);
			if(outerType != ""){		
				item = GetSymbolByName(outerType, position);
				if(item != null){	
					children = item.children;	
				}else{
					children = null;
				}
			} else{
				item = null;
			}
	
		}
	
	}

	return item;	
}

function GetItemForSignature(name: string, currentIdx: number,regexResult: any[],position: ls.Position): VizSymbol {
	let children: VizSymbol[] = null;
	let item: VizSymbol = null;
	for (var i = 0; i < currentIdx; i++) {
		
		if(children == null){
			item = GetSymbolByName(regexResult[i], position);
			if(item != null){
				children = item.children;
				if((children.length < 1) && (item.parentName != "global") && (item.parentName != "event")) {
					let innerItem = GetSymbolByName(item.type, position);
					if(innerItem != null){
						children = innerItem.children;
						item = innerItem;
					}
				}
			}
			
		}else{
			//let outerType = GetSymbolTypeInChildren(regexResult[i],children);
			let outerItem = GetSymbolInChildren(regexResult[i],children);
			if(outerItem != null){
				item = GetSymbolByName(outerItem.type, position);
				if(item != null){	
					children = item.children;	
				}else{
					children = null;
				}
			}
			if (i == currentIdx-1){
				item = outerItem;
			}		
		}
		
	}

	return item;	
}

connection.onCompletionResolve((complItem: ls.CompletionItem): ls.CompletionItem => {
	return complItem;
});

function GetSymbolsOfDocument(uri: string): ls.SymbolInformation[] {
	RefreshDocumentsSymbols(uri);
	return VizSymbol.GetLanguageServerSymbols(symbolCache[uri]);
}


function GetSymbolByName(name: string, position: ls.Position): VizSymbol {
	if(name == undefined) return null;
	let regexResult;
	let memberStartRegex: RegExp =/^array[\ ]*\[(.*?)\]/gi; // Remove array[]
	let isArrayType: Boolean = false;
	let type: string = "";
	memberStartRegex.lastIndex = 0;
	regexResult = memberStartRegex.exec(name);
	if(regexResult != null){
		name = regexResult[1];
	}

	if(name.endsWith("[]")){
		name = name.replace("[]", "");
		isArrayType = true;
		//connection.console.log("Type is array in GetSymbolByName! " + name);
	}

	regexResult = null;
	memberStartRegex =/([^.]*)\[(.*?)\]/gi; // Remove [] from arrays
	memberStartRegex.lastIndex = 0;
	regexResult = memberStartRegex.exec(name);
	if(regexResult != null){
		name = regexResult[1];
	}

	//Need to remove brackets on types but still get Array to work. Workaround by removing [] in Array completion

	let symbols = symbolCache["builtin"];
	let rootsymbols = symbolCache["builtin_root"];
	let rootthissymbols = symbolCache["builtin_root_this"];
	let globalsymbols = symbolCache["builtin_global"];
	let globalevents = symbolCache["builtin_events"];
	symbols = symbols.concat(rootsymbols);
	symbols = symbols.concat(rootthissymbols);
	symbols = symbols.concat(globalsymbols);
	symbols = symbols.concat(globalevents);
	let result: VizSymbol = null;
	if(symbols != []){
		symbols.forEach(item => {		
			if (item != null){
				if (item.name.toLowerCase() == name.toLowerCase()) {
					result = item;
				}
			}
			
		});
	}

	if(result == null){
		symbols = symbolCache[documentUri];
		symbols = GetSymbolsOfScope(symbols, position);
		//connection.console.log("Symbols " + symbols.length)
		if (symbols != []){
			symbols.forEach(item => {
				if (item != null){
					if (item.name.toLowerCase() == name.toLowerCase()) {
						result = item;
					}
				}
			});
		}


		if(result != null){
			if(result.type.toLowerCase().startsWith("array[")){
				if(isArrayType){
					let tmpType = GetRegexResult(result.type, /\[(.*?)\]/gi)
					result = GetSymbolByName(tmpType[1],position);
				}else{
					result = GetSymbolByName("Array",position);
				}
			}
		}
	}

	
	return result;
}

function GetSymbolInChildren(name: string, items: VizSymbol[] ): VizSymbol {
	let symbols = items;
	let result: VizSymbol = null;
	let isArrayType: boolean = false;

	if(name.endsWith("[]")){
		name = name.replace("[]", "");
		isArrayType = true;
		//connection.console.log("Type is array! " + name);
	}

	symbols.forEach(item => {
		if (item.name == name) {
			result = item;
		}
	});

	return result;
}

function GetSymbolTypeInChildren(name: string, items: VizSymbol[] ): string {
	let symbols = items;
	let result: VizSymbol = null;
	let type: string = "";
	let isArrayType: boolean = false;

	if(name.endsWith("[]")){
		name = name.replace("[]", "");
		isArrayType = true;
		//connection.console.log("Type is array! " + name);
	}

	symbols.forEach(item => {
		if (item.name == name) {
			result = item;
		}
	});
	if(result != null){
		if(result.type.toLowerCase().startsWith("array")){
			if(isArrayType){
				let tmpType = GetRegexResult(result.type, /\[(.*?)\]/gi)
				type = tmpType[1];
			}else{
				type = "Array";
			}
		} else{
			type = result.type;
		}
	}

	return type;
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
	// sort by start position
	if(symbols == undefined) return null;
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

	if(symbolTree == null)return [];

	let result = symbolTree.FindDirectParent(position).GetAllParentsAndTheirDirectChildren();

	let finalresult = [];

	result.forEach(element => {
		if(element.visibility != "hidden"){
			finalresult.push(element);
		}
	});

	return finalresult;
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
	documentUri = docParams.textDocument.uri;
	return GetSymbolsOfDocument(docParams.textDocument.uri);
});

function CollectSymbols(document: ls.TextDocument): VizSymbol[] {
	let symbols: Set<VizSymbol> = new Set<VizSymbol>();
	let lines = document.getText().split(/\r?\n/g);
	GetVizEvents();

	for (var i = 0; i < lines.length; i++) {
		let line = lines[i];
		let originalLine = line;

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
		statement.originalLine = originalLine;


		//connection.console.info("Line " + i.toString() + " is " + statement.line);
		FindSymbol(statement, document.uri, symbols);
	}


	return Array.from(symbols);
}

class LineStatement {
	startCharacter: number = 0;
	startLine: number = -1;
	line: string = "";
	originalLine: string = "";

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
	let rootsymbols: VizSymbol[] = [];
	let globalsymbols: VizSymbol[] = [];

	data.intellisense.completions.forEach(element => {
		if (element.name == "Global Procedures") {
			element.methods.forEach(submethod => {
				
				let symbol: VizSymbol = new VizSymbol();
				symbol.name = submethod.name;
				if (submethod.name.startsWith("\"Function")) symbol.kind = ls.CompletionItemKind.Function;
				else if (submethod.name.startsWith("\"Sub")) symbol.kind = ls.CompletionItemKind.Method;
				symbol.type = submethod.return_value;
				symbol.hint = submethod.code_hint;
				symbol.args = submethod.description;
				symbol.insertSnippet = GenerateSnippetString(symbol.hint, symbol.args);
				symbol.insertText = submethod.name;
				symbol.parentName = "global";
				symbol.signatureInfo = GenerateSignatureHelp(symbol.hint, symbol.args);
				symbol.commitCharacters = [""];
				let found = globalsymbols.find(item => item.name == submethod.name);
				if (found != null) {
					found.noOfOverloads ++;
					found.hint = found.name + "() (+ " + (found.noOfOverloads) + " overload(s))"
					found.overloads.push(symbol.signatureInfo);
				}else{
					globalsymbols.push(symbol);
				}
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
			symbol.signatureInfo = null;
			symbol.commitCharacters = ["."];
			if((symbol.name == "System")||(symbol.name == "Stage")||(symbol.name == "Scene")){
			  rootsymbols.push(symbol);
			}else{
			  symbols.push(symbol);
			}

			element.methods.forEach(submethod => {
				let subSymbol: VizSymbol = new VizSymbol();
				subSymbol.type = submethod.return_value;
				subSymbol.name = submethod.name;
				subSymbol.insertText = submethod.name;
				subSymbol.hint = submethod.code_hint;
				subSymbol.args = submethod.description;
				if (submethod.code_hint.startsWith("\"Function")) subSymbol.kind = ls.CompletionItemKind.Function;
				else if (submethod.code_hint.startsWith("\"Sub")) subSymbol.kind = ls.CompletionItemKind.Method;
				subSymbol.parentName = element.name;
				subSymbol.signatureInfo = GenerateSignatureHelp(subSymbol.hint, subSymbol.args);
				subSymbol.commitCharacters = [""];
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
				subSymbol.commitCharacters = ["."];
				symbol.children.push(subSymbol);
			});

		}
	});


	symbolCache["builtin"] = symbols;
	symbolCache["builtin_root"] = rootsymbols;
	symbolCache["builtin_global"] = globalsymbols;
	//connection.console.info("Found " + symbols.length + " builtin symbols in " + (Date.now() - startTime) + " ms");
}

function SetScriptType(languageId: string){
	let lScriptType = "";
	if(languageId == "viz"){
		lScriptType = "Scene";
	}else if(languageId == "viz-con"){
		lScriptType = "Container";
	} else{
		symbolCache["builtin_root_this"] = [];
		return;
	}
	if(scriptType == lScriptType) return;

	let symbol: VizSymbol = GetSymbolByName(lScriptType,ls.Position.create(0,0));
	let symbols: VizSymbol[] = [];
	if(symbol == null) {symbolCache["builtin_root_this"] = []; return false};
	let newsymbol: VizSymbol = new VizSymbol();
	newsymbol.kind = symbol.kind;
	newsymbol.type = symbol.type;
	newsymbol.name = "This";
	newsymbol.insertText = newsymbol.name;
	newsymbol.hint = symbol.hint;
	newsymbol.args = symbol.args;
	newsymbol.parentName = symbol.parentName;
	newsymbol.commitCharacters = symbol.commitCharacters;
	newsymbol.children = symbol.children;
	symbols.push(newsymbol);
	symbolCache["builtin_root_this"] = symbols;
	scriptType = lScriptType;
}

function GetVizEvents() {

	let symbols: VizSymbol[] = [];

	vizevent.events.forEach(event => {
		let symbol: VizSymbol = new VizSymbol();
		symbol.kind = ls.CompletionItemKind.Event;
		symbol.type = "Event";
		symbol.name = event.name;
		symbol.insertText = event.code_hint;
		symbol.insertText = symbol.insertText.replace("Sub ", "");
		symbol.hint = event.code_hint;
		symbol.args = event.description;
		symbol.kind = ls.CompletionItemKind.Variable;
		symbol.signatureInfo = GenerateSignatureHelp(symbol.hint, symbol.args);
		symbol.parentName = "event";
		symbol.visibility = "";
		symbol.commitCharacters = [""];
		symbols.push(symbol);
	});

	symbolCache["builtin_events"] = symbols;
	//connection.console.info("Found " + symbols.length + " builtin events in " + (Date.now() - startTime) + " ms");
}

function SelectBuiltinCompletionItems(): ls.CompletionItem[] {
	return VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin"]);
}

function SelectBuiltinRootCompletionItems(): ls.CompletionItem[] {
	return VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin_root"]);
}

function SelectBuiltinRootThisCompletionItems(): ls.CompletionItem[] {
	if(symbolCache["builtin_root_this"] == undefined) return [];
	return VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin_root_this"]);
}

function SelectBuiltinGlobalCompletionItems(): ls.CompletionItem[] {
	if(settings != null){
		if(settings.enableGlobalProcedureSnippets){
			return VizSymbol.GetLanguageServerSnippetCompletionItems(symbolCache["builtin_global"]);
		}else{
			return VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin_global"]);
		}
	} else {
		return VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin_global"]);
	}
}

function SelectBuiltinEventCompletionItems(): ls.CompletionItem[] {
	return VizSymbol.GetLanguageServerCompletionItems(symbolCache["builtin_events"]);
}

let pendingChildren: VizSymbol[] = [];


function FindSymbol(statement: LineStatement, uri: string, symbols: Set<VizSymbol>): void {
	let newSym: VizSymbol;
	let newSyms: VizSymbol[] = null;
	let currentSymbols =Array.from(symbols);
		
	if (GetMethodStart(statement, uri)) {
		return;
	}

	newSyms = GetMethodSymbol(statement, uri);
	if (newSyms != null && newSyms.length != 0) {
		let found = currentSymbols.find(item => item.name == newSyms[newSyms.length-1].name);
		if ((found != null) && ((found.kind == ls.CompletionItemKind.Function) || (found.kind == ls.CompletionItemKind.Method))) {
			found.noOfOverloads ++;
			found.hint = found.name + "() (+ " + (found.noOfOverloads) + " overload(s))"
			found.overloads.push(newSyms[newSyms.length-1].signatureInfo);
			newSyms[newSyms.length-1].visibility = "hidden";
		}
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
	hint: string;
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
		return false;

	openMethod = null;

	let leadingSpaces = GetNumberOfFrontSpaces(line);
	let preLength = leadingSpaces + regexResult.index;

	for (var i = 1; i < 3; i++) {
		var resElement = regexResult[i];
		if (resElement != null)
			preLength += resElement.length;
	}

	
	let lines = documents.get(documentUri).getText().split(/\r?\n/g);
	let descriptionLines = [];
	let description = "";
	let offset = 1;
	let stop = false;
	if(lines != undefined){
		if ((lines.length != 0) ){
			while ((statement.startLine-offset >= 0) && (!stop)) {
				let line = lines[statement.startLine- offset];
				if(line != undefined){
					if(line.trim().startsWith("'")){
						descriptionLines.push(lines[statement.startLine-offset]);
						offset ++;
					}else{
						stop = true;
					}
				} else{
					stop = true;
				}
				
				//connection.console.log(lines[statement.startLine-offset]);
			}
		
			if (descriptionLines.length != 0){
				for (let i = descriptionLines.length - 1; i >= 0; i--) {
					description += descriptionLines[i].replace("'", "") + "\n";
				}
			}
		} 
	}
	
	
	
	
	//connection.console.log("Opening bracket at: " + (preLength+1).toString());

	openMethod = {
		type: regexResult[1],
		name: regexResult[2],
		argsIndex: preLength + 1, // opening bracket
		args: regexResult[4],
		hint: description,
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
		//console.error("ERROR - line " + statement.startLine + " at " + statement.startCharacter + ": There is no " + type + " to end!");
		return null;
	}
	if (type != null){
		if (type.toLowerCase() != openMethod.type.toLowerCase()) {
			return null;
			// ERROR!!! I expected end function|sub and not sub|function!
			// show the user the error and then go on like it was the right type!
			//console.error("ERROR - line " + statement.startLine + " at " + statement.startCharacter + ": 'end " + openMethod.type + "' expected!");
		}
	}
	

	let range: ls.Range = ls.Range.create(openMethod.startPosition, statement.GetPostitionByCharacter(GetNumberOfFrontSpaces(line) + regexResult[0].trim().length))

	let globalevents = symbolCache["builtin_events"];
	let result: VizSymbol = null;
	if(globalevents != []){
		globalevents.forEach(item => {		
			if (item != null){
				if (item.name.toLowerCase() == openMethod.name.toLowerCase()) {
					item.visibility = "hidden";
					result = item;
				}
			}
			
		});
	}

	if(result != null){
		result.nameLocation = openMethod.nameLocation;
		result.symbolRange = range;
		let parametersSymbol = [];
		parametersSymbol = GetParameterSymbols(result.name, openMethod.args, openMethod.argsIndex, openMethod.statement, uri);
		openMethod = null;
		return parametersSymbol.concat(result);
	}

	let symbol: VizSymbol = new VizSymbol();
	if(type == "function")symbol.kind = ls.CompletionItemKind.Function;
	if(type == "sub")symbol.kind = ls.CompletionItemKind.Method;
	symbol.type = openMethod.type;
	symbol.name = openMethod.name;
	symbol.hint = openMethod.statement.line;
	symbol.insertText = openMethod.name;
	symbol.args = openMethod.hint;
	symbol.nameLocation = openMethod.nameLocation;
	symbol.parentName = openMethod.name;
	symbol.signatureInfo = GenerateSignatureHelp(symbol.hint, symbol.args);
	symbol.commitCharacters = [""];
	symbol.symbolRange = range;

	let parametersSymbol = [];
	parametersSymbol = GetParameterSymbols(openMethod.name, openMethod.args, openMethod.argsIndex, openMethod.statement, uri);

	openMethod = null;
	//return [symbol];
	
	return parametersSymbol.concat(symbol);
}

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
		varSymbol.commitCharacters = ["."];
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
	symbol.commitCharacters = [""];
	symbol.parentName = openStructureName;

	return symbol;
}

function GetVariableNamesFromList(vars: string): string[] {
	return vars.split(',').map(function (s) { return s.trim(); });
}

function GetVariableSymbol(statement: LineStatement, uri: string): VizSymbol[] {
	let line: string = statement.originalLine;

	let variableSymbols: VizSymbol[] = [];
	let memberStartRegex: RegExp = /^[ \t]*dim[ \t]+([a-zA-Z0-9\-\_\,\s]+)[ \t]+as[ \t]+([a-zA-Z0-9\-\_\,\[\]\s]+)[^\']*([\']?.*)$/gi;

	let regexResult = memberStartRegex.exec(line);

	if (regexResult == null || regexResult.length < 3)
		return null;

	// (dim[ \t]+)
	let variables = GetVariableNamesFromList(regexResult[1]);
	let intendention = GetNumberOfFrontSpaces(line);
	let nameStartIndex = line.indexOf(line);
	let parentName: string = "root";

	let type: string = regexResult[2].trim();


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
		symbol.args = regexResult[3].replace("'", "");
		symbol.hint = varName + " as " + type;
		symbol.kind = ls.CompletionItemKind.Variable;
		symbol.nameLocation = ls.Location.create(uri,
			GetNameRange(statement, varName)
		);


		symbol.symbolRange = ls.Range.create(
			ls.Position.create(symbol.nameLocation.range.start.line, symbol.nameLocation.range.start.character),
			ls.Position.create(symbol.nameLocation.range.end.line, symbol.nameLocation.range.end.character)
		);

		

		symbol.parentName = parentName;
		symbol.commitCharacters = ["."];

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
	let parentName: string = "root";

	let classEndRegex: RegExp = /^[ \t]*end[ \t]+structure[ \t]*$/gi;

	if (openStructureName == null)
		return null;

	let regexResult = classEndRegex.exec(line);

	if (regexResult == null || regexResult.length < 1)
		return null;

	if (openMethod != null) {
		// ERROR! expected to close method before!
		//console.error("ERROR - Structure - line " + statement.startLine + " at " + statement.startCharacter + ": 'end " + openMethod.type + "' expected!");
		return null;
	}

	if (openProperty != null) {
		// ERROR! expected to close property before!
		//console.error("ERROR - Structure - line " + statement.startLine + " at " + statement.startCharacter + ": 'end property' expected!");
		return null;
	}

	if (openStructureName != null)
		parentName = openStructureName;

	let range: ls.Range = ls.Range.create(openStructureStart, statement.GetPostitionByCharacter(regexResult[0].length))
	let symbol: VizSymbol = new VizSymbol();
	symbol.kind = ls.CompletionItemKind.Struct;
	symbol.name = openStructureName;
	symbol.type = symbol.name;
	symbol.insertText = symbol.name;
	symbol.parentName = parentName;
	symbol.nameLocation = ls.Location.create(uri,
		ls.Range.create(openStructureStart,
			ls.Position.create(openStructureStart.line, openStructureStart.character + openStructureName.length)
		)
	);
	symbol.symbolRange = range;
	symbol.commitCharacters = [""];
	symbol.children = children;

	
	//let symbol: ls.SymbolInformation = ls.SymbolInformation.create(openClassName, ls.SymbolKind.Class, range, uri);

	openStructureName = null;
	openStructureStart = ls.Position.create(-1, -1);

	return symbol;
}

connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	symbolCache[params.textDocument.uri] = null;
	//connection.console.log(`${params.textDocument.uri} closed.`);
});


function DisplayDiagnostics(uri: string, range: ls.Range, message: string): void {
	let diagnostics: ls.Diagnostic[] = [];

	let diagnostic: ls.Diagnostic = {
		severity: ls.DiagnosticSeverity.Error,
		range: range,
		message: message,
		source: 'Viz Script'
	};
	diagnostics.push(diagnostic);

	connection.sendDiagnostics({ uri, diagnostics });

}

function ClearDiagnostics(uri: string) {
	let diagnostics: ls.Diagnostic[] = [];
	connection.sendDiagnostics({ uri, diagnostics });
}

connection.onRequest('getVizScripts', (code: string) => {
	return test;
});

connection.onRequest('getVizConnectionInfo', () => {
	let connectionInfo = [settings.compiler.hostName, settings.compiler.hostPort, scriptType];
	return connectionInfo;
});

connection.onRequest('showDiagnostics', (vizReply: string) => {
	let error = GetRegexResult(vizReply, /\{(.*?)(\((.*)\))?\}/gi)
	if((error != undefined) && (error.length > 2)){
		let rangesplit = error[3].split("/");
		let line = parseInt(rangesplit[0]);
		let char = parseInt(rangesplit[1]);
		let range = ls.Range.create(line-1, char-1, line-1, char);
		DisplayDiagnostics(documentUri,range,error[1])
		connection.window.showErrorMessage(error[1])
		return error[3] 
	} else{
		return error[1]
	}
})
	


  

// Listen on the connection
connection.listen();
