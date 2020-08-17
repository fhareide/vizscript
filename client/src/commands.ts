
import {showMessage} from './showMessage';
import {showUntitledWindow} from './showUntitledWindow';
import {ExtensionContext, QuickPickItem, TextEditor, window, Diagnostic, DiagnosticSeverity, Range, languages, commands, Uri, Position, Selection} from 'vscode';
import {LanguageClient} from 'vscode-languageclient';
import {VizScriptObject} from './vizScriptObject'
import {getVizScripts, compileScript, compileScriptId} from './vizCommunication'

let scriptObjects: Map<string, VizScriptObject> = new Map()
	
export function displayScriptSelector(context: ExtensionContext, client: LanguageClient, editor: TextEditor) {
  window.setStatusBarMessage('Fetching script list from Viz...',
		requestAllScripts(client)
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
					elements = [newFileItem, currentFileItem]
					
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
					context.workspaceState.update(editor.document.uri.toString(), vizId)
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
			//.then((file) => {
			//	window.showInformationMessage((<TextEditor>file).document.fileName)
			//	return commands.executeCommand('vscode.diff', editor.document.uri , (<TextEditor>file).document.uri)
			//})
      .then(undefined, showMessage)
  );
}

export function requestAllScripts(client: LanguageClient) {
	return new Promise((resolve, reject) => {
		window.setStatusBarMessage(
			'Getting viz scripts...',
			client.sendRequest('getVizConnectionInfo')
			.then(result => getVizScripts(result[0], Number(result[1]), result[2]))
			.then((reply) => {
					scriptObjects = reply;
					let elements = [];
					reply.forEach(element =>{
						let quickPickItem: QuickPickItem = {
							description: element.type + " " + element.name,
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

export function compileCurrentScript(context: ExtensionContext, client: LanguageClient, editor: TextEditor){
	client.sendRequest('getVizConnectionInfo')
	.then(result => {
		compileScriptId(window.activeTextEditor.document.getText() ,result[0], Number(result[1]), result[2], context.workspaceState.get(window.activeTextEditor.document.uri.toString()))
	})
	.then((message) => client.sendRequest('showDiagnostics', message))
	.then((answer) => {
		if( (<string>answer) === "OK"){
			window.setStatusBarMessage("Compilation successful!")
		} else{
			let rangesplit = (<string>answer).split("/");
			let line = parseInt(rangesplit[0]);
			let char = parseInt(rangesplit[1]);
			let range = new Range(line-1, char-1, line-1, char);
			let editor = window.activeTextEditor;
			editor.selection =  new Selection(range.start, range.end);
			editor.revealRange(range);
		}
		
	})
}

export function syntaxCheckCurrentScript(context: ExtensionContext, client: LanguageClient, editor: TextEditor){
	client.sendRequest('getVizConnectionInfo')
	.then(result => compileScript(window.activeTextEditor.document.getText() ,result[0], Number(result[1]), result[2]))
	.then((message) => client.sendRequest('showDiagnostics', message))
	.then((answer) => {
		let rangesplit = (<string>answer).split("/");
		let line = parseInt(rangesplit[0]);
		let char = parseInt(rangesplit[1]);
		let range = new Range(line-1, 0, line-1, char);
		let editor = window.activeTextEditor;
		editor.selection =  new Selection(range.start, range.end);
		editor.revealRange(range);
	})
}


function GetRegexResult(line: string, regex: RegExp): string[] {
	let RegexString: RegExp = regex;
	return RegexString.exec(line);
}