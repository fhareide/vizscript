/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import {showMessage} from './showMessage';
import {showUntitledWindow} from './showUntitledWindow';
import {ExtensionContext, QuickPickItem, TextEditor, window, Diagnostic, DiagnosticSeverity, Range, languages, commands, Uri, Position, Selection, workspace, StatusBarAlignment, StatusBarItem} from 'vscode';
import {LanguageClient} from 'vscode-languageclient/node';
import {VizScriptObject} from './vizScriptObject'
import {ThemeColor} from 'vscode'
import {getVizScripts, compileScript, compileScriptId} from './vizCommunication'

let scriptObjects: Map<string, VizScriptObject> = new Map()

export function displayScriptSelector(context: ExtensionContext) {
	window.setStatusBarMessage('Fetching script list from Viz...',5000)
		getConfig()
		.then((connectionString) => {
			return requestAllScripts(connectionString)
		})
		.then((selectedScript) => {
			if (selectedScript === undefined) {
				throw 0;
			}
				let elements = [];
				let currentFileItem: QuickPickItem = {
					description: "",
					label: "Add script to current file",
					detail: ""
				}
				let newFileItem: QuickPickItem = {
					description: "",
					label: "Open script in new file",
					detail: ""
				}
				if(window.activeTextEditor == undefined){
					elements = [newFileItem]
				}else{
					elements = [newFileItem, currentFileItem]
				}


				return Promise.all([
					window.showQuickPick(elements, { matchOnDescription: true, matchOnDetail: false, placeHolder: 'Select your script'}),
					selectedScript
				])
			})
		.then(([selection, data]) => {
			if (selection === undefined) {
				throw 0;
			}
			//window.showInformationMessage(selection.label)
			let vizId = "";
			vizId = (<QuickPickItem>data).label;
			vizId = vizId.replace("#","")
			return Promise.all([scriptObjects.get((<QuickPickItem>data).label), vizId, scriptObjects.get((<QuickPickItem>data).label).extension, selection]);
		})
		.then(([object, vizId, extension, selection]): Thenable<any> => {
			if(selection.label === "Add script to current file"){
				context.workspaceState.update(window.activeTextEditor.document.uri.toString(), vizId)
				return window.activeTextEditor.edit((builder) => {
					const lastLine = window.activeTextEditor.document.lineCount;
					const lastChar = window.activeTextEditor.document.lineAt(lastLine - 1).range.end.character;
					builder.delete(new Range(0, 0, lastLine, lastChar));
					builder.replace(new Position(0, 0), object.code);
				});
			}else if(selection.label === "Open script in new file"){
				return Promise.resolve(showUntitledWindow( vizId, extension, object.code, context));
			}
		})
		.then(undefined, showMessage)
}

export function requestAllScripts(connectionInfo: VizScriptCompilerSettings){
	return new Promise((resolve, reject) => {
		window.setStatusBarMessage('Getting viz scripts...',
			getVizScripts(connectionInfo.hostName, Number(connectionInfo.hostPort))
			.then((reply) => {
					scriptObjects = reply;
					let elements = [];
					reply.forEach(element =>{
						let quickPickItem: QuickPickItem = {
							description: ((element.children.length <= 0) ?element.type + " " + element.name : element.type + " " + element.name + " (+" + element.children.length + " cons)"),
							label: element.vizId,
							detail: element.code.substr(0, 100)
						}
						elements.push(quickPickItem)
					})
					resolve(window.showQuickPick(elements, {
						matchOnDescription: true,
						matchOnDetail: false,
						placeHolder: 'Select your script'
					}))
				})
			.catch((reason => reject(window.showErrorMessage(reason)))));
	})
}

let compileMessage : StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Left,0);

export function compileCurrentScript(context: ExtensionContext, client: LanguageClient, editor: TextEditor){
	client.sendRequest('getVizConnectionInfo')
	.then(result => {
		let linkedId: string = context.workspaceState.get(window.activeTextEditor.document.uri.toString());
		return compileScriptId(window.activeTextEditor.document.getText() ,result[0], Number(result[1]), result[2], linkedId, null)
	})
	.then((message) => client.sendRequest('showDiagnostics', message))
	.then(([error, rangeString]) => {
		if(error == "OK"){
			
			compileMessage.text = '$(check) Script successfully set in Viz. No errors';
			compileMessage.backgroundColor = "";
			showStatusMessage(compileMessage);
		}else{
			let rangesplit = (<string>rangeString).split("/");
			let line = parseInt(rangesplit[0]);
			let char = parseInt(rangesplit[1]);
			let range = new Range(line-1, 0, line-1, char);
			let editor = window.activeTextEditor;
			editor.selection =  new Selection(range.start, range.end);
			editor.revealRange(range);
 
			compileMessage.text = "$(error) " + error;
			compileMessage.backgroundColor = new ThemeColor('statusBarItem.errorBackground');
			showStatusMessage(compileMessage);
		}
	})
}

export function syntaxCheckCurrentScript(context: ExtensionContext, client: LanguageClient, editor: TextEditor){
	client.sendRequest('getVizConnectionInfo')
	.then(result => compileScript(window.activeTextEditor.document.getText() ,result[0], Number(result[1]), result[2]))
	.then((message) => client.sendRequest('showDiagnostics', message))
	.then(([error, rangeString]) => {
		if(error == "OK"){
			
			compileMessage.text = '$(check) Compile OK';
			compileMessage.backgroundColor = "";
			showStatusMessage(compileMessage);
		}else{
			let rangesplit = (<string>rangeString).split("/");
			let line = parseInt(rangesplit[0]);
			let char = parseInt(rangesplit[1]);
			let range = new Range(line-1, 0, line-1, char);
			let editor = window.activeTextEditor;
			editor.selection =  new Selection(range.start, range.end);
			editor.revealRange(range);
 
			compileMessage.text = "$(error) " + error;
			compileMessage.backgroundColor = new ThemeColor('statusBarItem.errorBackground');
			showStatusMessage(compileMessage);
		}
	})
}

async function showStatusMessage(currentErrorMessage: StatusBarItem) {
  currentErrorMessage.show();
	await delay(10000);
	currentErrorMessage.hide();
}


function delay(ms: number){
  return new Promise(resolve => setTimeout(resolve, ms));
}


function GetRegexResult(line: string, regex: RegExp): string[] {
	let RegexString: RegExp = regex;
	return RegexString.exec(line);
}

class VizScriptCompilerSettings {
	hostName: string;
	hostPort: number;
}

function getConnectionSettings(): Promise<VizScriptCompilerSettings> {
	let config = workspace.getConfiguration("vizscript.compiler")
	let result = new VizScriptCompilerSettings;
	result.hostName = config.get("hostName");
	result.hostPort = config.get("hostPort");
	return Promise.resolve(result)
}


async function getConfig(): Promise<VizScriptCompilerSettings> {
	return await getConnectionSettings();
}