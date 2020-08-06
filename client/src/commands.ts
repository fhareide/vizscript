
import {showMessage} from './showMessage';
import {showUntitledWindow} from './showUntitledWindow';
import {ExtensionContext, QuickPickItem, TextEditor, window, Diagnostic, DiagnosticSeverity, Range, languages} from 'vscode';
import {LanguageClient} from 'vscode-languageclient';
import {VizScriptObject} from './vizScriptObject'
import {getVizScripts, compileScript} from './vizCommunication'

let scriptObjects: Map<string, VizScriptObject> = new Map()
	
export function displayScriptSelector(context: ExtensionContext, client: LanguageClient, editor: TextEditor) {
  window.setStatusBarMessage('Fetching script list from Viz...',
		requestAllScripts(client)
      .then((selectedApi) => {
        if (selectedApi === undefined) {
          throw 0;
        }
				let vizId = "";
				vizId = (<QuickPickItem>selectedApi).label;
				vizId = vizId.replace("#","")

        return Promise.all([scriptObjects.get((<QuickPickItem>selectedApi).label), vizId, scriptObjects.get((<QuickPickItem>selectedApi).label).extension]);
      })
      .then(([object, vizId, extension]): Thenable<any> => {
        return showUntitledWindow(`containerScript${vizId}${extension}`, object.code, context.extensionPath);    
      })
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
							detail: element.code.substr(0, 40)
						}
						elements.push(quickPickItem)
					})
					resolve(window.showQuickPick(elements, {
						matchOnDescription: true,
						matchOnDetail: false,
						placeHolder: 'Select your script'
					}))
				})
			.catch((reason => window.showErrorMessage(reason))));
	})
}

export function compileCurrentScript(context: ExtensionContext, client: LanguageClient, editor: TextEditor){
	client.sendRequest('getVizConnectionInfo')
	.then(result => compileScript(window.activeTextEditor.document.getText() ,result[0], Number(result[1]), result[2]))
	.then((message) => client.sendRequest('showDiagnostics', message))
}


function GetRegexResult(line: string, regex: RegExp): string[] {
	let RegexString: RegExp = regex;
	return RegexString.exec(line);
}