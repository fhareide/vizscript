
import {showMessage} from './showMessage';
import {showUntitledWindow} from './showUntitledWindow';
import {ExtensionContext, Position, QuickPickItem, Range, TextEditor, Uri,
	ViewColumn, commands, window, workspace} from 'vscode';
import {LanguageClient} from 'vscode-languageclient';
import * as net from 'net'
import {VizScriptObject} from './vizScriptObject'



let sceneId = "";
let containerId = "";
let scriptId = "";

let thisHost = "";
let thisPort: number = -1;
let thisScriptType = "";

let resultObjects: VizScriptObject[] = [];
	
export function fetchScriptContent(context: ExtensionContext, client: LanguageClient, editor: TextEditor) {
  window.setStatusBarMessage('Fetching script list from Viz...',
		getVizScripts(client)
      .then((selectedApi) => {
        if (selectedApi === undefined) {
          throw 0;
        }
				let vizId = "";
				vizId = (<any>selectedApi).label;
				vizId = vizId.replace("#","")

        return Promise.all([getScript((<any>selectedApi).label), vizId]);
      })
      .then(([code, vizId]): Thenable<any> => {
        return showUntitledWindow(`containerScript${vizId}.vs`, (<any>code), context.extensionPath);    
      })
      .then(undefined, showMessage)
  );

}

export function getVizScripts(client: LanguageClient) {
	return new Promise((resolve, reject) => {
		window.setStatusBarMessage(
			'Getting viz scripts...',
			client.sendRequest('getVizConnectionInfo')
			.then(result => requestScripts(result[0], Number(result[1]), result[2]))
			.then((reply) => {
				const elements = reply.map(element =>
					<QuickPickItem>{
					description: element.name,
					detail: element.code.substr(0, 40),
					label: element.vizId,
					});
				resolve(window.showQuickPick(elements, {
					matchOnDescription: true,
					matchOnDetail: false,
					placeHolder: 'Select your script'
				}))
			})
			.catch((reason => window.showErrorMessage(reason))));
	})
}



export function openFile(context: ExtensionContext, client: LanguageClient, editor: TextEditor) {
	window.setStatusBarMessage(
	  'Parsing current document...',
	  client.sendRequest('getVizFiles', editor.document.getText())
		.then(result => showUntitledWindow('sceneScript.vs', JSON.stringify(result, null, 2), context.extensionPath),
		(err) => {
		  if (err.result !== undefined) {
			return showUntitledWindow('sceneScript.vs', JSON.stringify(err.result, null, 2), context.extensionPath);
		  }
  
		  throw err;
		})
		.then(undefined, showMessage)
	);
  }

function GetRegexResult(line: string, regex: RegExp): string[] {
	let RegexString: RegExp = regex;
	return RegexString.exec(line);
}


function requestScripts(host: string, port: number, scriptType: string): Promise<VizScriptObject[]>{
	return new Promise((resolve, reject) => {
		let scripts = [];

		thisHost = host;
		thisPort = port;
		thisScriptType = scriptType;

		//MAIN*CONFIGURATION*COMMUNICATION*PROCESS_COMMANDS_ALWAYS GET

		const socket = net.createConnection({ port: port, host: host}, () => {
			// 'connect' listener.
			//connection.console.log('Connected to Viz Engine!');
			//connection.window.showInformationMessage("Connected to Viz Engine on " + host + ":" + port );
			socket.write('1 MAIN IS_ON_AIR ' + String.fromCharCode(0));
		});
		
		//connection.console.log('Script type is: ' + scriptType);

		socket.on('data', (data) => {
			let message = data.toString().replace(String.fromCharCode(0), '')

			let answer = GetRegexResult(message, /^([^\s]+)(\s?)(.*)/gi)
			
			if(answer[1] == "1"){
				//connection.console.log("Viz Engine is OnAir");
					socket.write('2 MAIN_SCENE*OBJECT_ID GET ' + String.fromCharCode(0));
				
			}else if(answer[1] == "2"){
				sceneId = answer[3];
				socket.write('3 '+ sceneId +'*TREE SEARCH_FOR_CONTAINER_WITH_PROPERTY SCRIPT ' + String.fromCharCode(0));
				//socket.write('7 '+ sceneId +'*TREE ADD TOP ' + String.fromCharCode(0));
			}else if(answer[1] == "3"){
				//connection.console.log(answer[3]);
				if(answer[3] === "") reject("No container scripts in scene") 
				scripts = answer[3].split(" ");
				let results = scripts.map((item) => {
					return new Promise((resolve) => {
						Promise.all([getScript(item), item])
						.then(([result, vizId]) => {
							let vizObject = new VizScriptObject()
							vizObject.vizId = vizId;
							vizObject.name = result[1];
							vizObject.code = result[0];
							resultObjects.push(vizObject);
							resolve("Success")
						})
						.catch((message) => window.showErrorMessage("Failed " + message))
					})
				})

				Promise.all(results).then(() => socket.end())
			
				
				//socket.write('4 '+ scriptId +'*SCRIPT*PLUGIN COMPILE ' + String.fromCharCode(0));
			}else if(answer[1] == "4"){
				//connection.console.log(answer[3]);
				socket.write('5 '+ scriptId +'*SCRIPT*PLUGIN*COMPILE_STATUS GET ' + String.fromCharCode(0));
			}else if(answer[1] == "5"){

			}else if(answer[1] == "6"){
				if(answer[3] == "<00000000-0000-0000-0000000000000000>"){
					if(containerId != ""){
						socket.write('9 '+ containerId +'*SCRIPT*STATUS GET ' + String.fromCharCode(0));
					}else{
						socket.write('7 '+ sceneId +'*TREE ADD TOP ' + String.fromCharCode(0));
					}
				} else {
					socket.write('2 SCENE NEW ' + String.fromCharCode(0));
				}
				
			}else if(answer[1] == "7"){
				//connection.window.showInformationMessage("Answer: " + answer[3])
				if(answer[3] == "1"){
					socket.write('8 '+ sceneId +'*TREE*/1*OBJECT_ID GET ' + String.fromCharCode(0));
				}
			}else if(answer[1] == "8"){
				if(answer[3].startsWith("#")){
					containerId = answer[3];
				} else{
					window.showErrorMessage("No container found")
					return;
				}
				socket.write('-1 '+ containerId +'*SCRIPT SET SCRIPT*Script ' + String.fromCharCode(0));
				socket.write('9 '+ containerId +'*SCRIPT*STATUS GET ' + String.fromCharCode(0));

			}else if(answer[1] == "9"){
				if(scriptType == "Scene"){
					scriptId = sceneId;
				}else if(scriptType = "Container"){
					scriptId = containerId;
				}
				socket.write('3 '+ scriptId +'*SCRIPT*PLUGIN*SOURCE_CODE SET '  + String.fromCharCode(0));

			} 
			
		});

		socket.on('error', () => {
			sceneId = "";
			containerId = "";
			reject("Not able to connect to Viz Engine " + host + ":" + port);
		});

		let scriptObjects: VizScriptObject[] = [];

		

		socket.on('end', () => {	
			console.log('Disconnected Viz Engine');
			resolve(resultObjects)
		});
	})
}

function getScript(vizId: string): Promise<string[]>{
	return new Promise((resolve, reject) => {
		let code = "";
		let name = "";

		const socket = net.createConnection({ port: thisPort, host: thisHost}, () => {
			socket.write('1 MAIN*CONFIGURATION*COMMUNICATION*PROCESS_COMMANDS_ALWAYS GET ' + String.fromCharCode(0));
		});
		
		//connection.console.log('Script type is: ' + scriptType);
		let isReceivingData = false
		let replyCode = "-1"

		socket.on('data', (data) => {
			
			let message = data.toString()

			if(!isReceivingData){
				replyCode = GetRegexResult(message, /^([^\s]+)(\s?)/gim)[1]
				message = message.slice(2)
			}
			
			if(replyCode == "1"){
				if(message.replace(String.fromCharCode(0), '') == "0"){
					reject("PROCESS_COMMANDS_ALWAYS not set to 1 in configuration")
				}
				if(vizId != ""){
					socket.write('2 '+ vizId +'*NAME GET '  + String.fromCharCode(0));
				}
				
			}else if(replyCode == "2"){
				name = message.slice(0, message.length-1)
				socket.write('3 '+ vizId +'*SCRIPT*PLUGIN*SOURCE_CODE GET '  + String.fromCharCode(0));
			}else if(replyCode == "3"){
				isReceivingData = true
				
				if(message.endsWith(String.fromCharCode(0))){
					message = message.slice(0, message.length-2)
					isReceivingData = false					
					socket.end()
				}

				code += message;
				
			}
			
		});

		socket.on('error', () => {
			sceneId = "";
			containerId = "";
			reject("Not able to connect to Viz Engine " + thisHost + ":" + thisPort);
		});
		

		socket.on('end', () => {	
			console.log('Disconnected Viz Engine');
			resolve([code,name])
		});
	})
}