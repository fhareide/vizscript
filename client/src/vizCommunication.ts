/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as net from 'net'
import {window, Range} from 'vscode';
import {VizScriptObject} from './vizScriptObject'

let sceneId = "";
let containerId = "";
let scriptId = "";

let thisHost = "";
let thisPort: number = -1;


export function getVizScripts(host: string, port: number): Promise<Map<string,VizScriptObject>>{
	return new Promise((resolve, reject) => {
		let scripts = [];

		let currentObjectId = "";
		thisHost = host;
		thisPort = port;
		let scriptObjects: Map<string, VizScriptObject> = new Map()

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
					currentObjectId = answer[3];
					let result = new Promise((resolve) => {
						Promise.all([getVizScriptContent(currentObjectId), currentObjectId])
						.then(([result, vizId]) => {
							let vizObject = new VizScriptObject()
							vizObject.vizId = vizId;
							vizObject.type = "Scene";
							vizObject.extension = ".vs"
							vizObject.children = []
							vizObject.name = result[1];
							vizObject.code = result[0];
							scriptObjects.set(vizId , vizObject);
							resolve(message)
						})
						.then(() => socket.write('3 '+ currentObjectId +'*TREE SEARCH_FOR_CONTAINER_WITH_PROPERTY SCRIPT ' + String.fromCharCode(0)))
						.catch((message) => window.showErrorMessage("Failed " + message))
					})
					//socket.write('7 '+ sceneId +'*TREE ADD TOP ' + String.fromCharCode(0));
			}else if(answer[1] == "3"){
				//connection.console.log(answer[3]);
				if(answer[3] === "") socket.end();
				scripts = answer[3].split(" ");
				let results = scripts.map((item) => {
					return new Promise<VizScriptObject>((resolve) => {
						Promise.all([getVizScriptContent(item), item])
						.then(([result, vizId]) => {
							let vizObject = new VizScriptObject()
							vizObject.vizId = vizId;
							vizObject.type = "Container";
							vizObject.extension = ".vsc"
							vizObject.children = []
							vizObject.name = result[1];
							vizObject.code = result[0];

							resolve(vizObject)
						})
						.catch((message) => window.showErrorMessage("Failed " + message))
					})
				})

				Promise.all(results).then((results) => {
					results.forEach(element => {
						scriptObjects.set(element.vizId , element);
						//let isDuplicate = false;
						//for (let object of scriptObjects.values()) {
						//	if(object.code == element.code){
						//		object.children.push(element);
						//		isDuplicate = true;
						//		break;
						//	}
						//}
						//if( !isDuplicate){
						//	scriptObjects.set(element.vizId , element);
						//}

					});

					socket.end()})
			}
		});

		socket.on('error', () => {
			currentObjectId = "";
			reject("Not able to connect to Viz Engine " + host + ":" + port);
		});


		socket.on('end', () => {
			console.log('Disconnected Viz Engine');
			resolve(scriptObjects)
		});
	})
}

function getVizScriptContent(vizId: string): Promise<string[]>{
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
				message.replace(String.fromCharCode(0), '')
			}

			if(replyCode == "1"){
				if(message == "0"){
					reject("PROCESS_COMMANDS_ALWAYS not set to 1 in configuration")
				}
				if(vizId != ""){
					socket.write('2 '+ vizId +'*NAME GET '  + String.fromCharCode(0));
				}

			}else if(replyCode == "2"){
				name = message
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
			reject("Not able to connect to Viz Engine " + thisHost + ":" + thisPort);
		});


		socket.on('end', () => {
			console.log('Disconnected Viz Engine');
			resolve([code,name])
		});
	})
}

export function compileScript(content: string, host: string, port: number, scriptType: string){
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ port: port, host: host}, () => {

			socket.write('1 MAIN*CONFIGURATION*COMMUNICATION*PROCESS_COMMANDS_ALWAYS GET ' + String.fromCharCode(0));
		});

		let text = content;
		let isReceivingData = false
		let replyCode = "-1"
		//connection.console.log('Script type is: ' + scriptType);

		socket.on('data', (data) => {
			let message = data.toString()

			if(!isReceivingData){
				replyCode = GetRegexResult(message, /^([^\s]+)(\s?)/gim)[1]
				message = message.slice(2)
				message = message.replace(String.fromCharCode(0), '')
			}

			if(replyCode == "1"){
				//connection.console.log("Viz Engine is OnAir");
				if(sceneId == ""){
					socket.write('2 SCENE NEW ' + String.fromCharCode(0));
				} else {
					socket.write('6 '+ sceneId +'*UUID GET ' + String.fromCharCode(0));
				}
			}else if(replyCode == "2"){
				sceneId = message.replace("SCENE*", "");
				socket.write('7 '+ sceneId +'*TREE ADD TOP ' + String.fromCharCode(0));
			}else if(replyCode == "3"){
				//connection.console.log(message);
				socket.write('4 '+ scriptId +'*SCRIPT*PLUGIN COMPILE ' + String.fromCharCode(0));
			}else if(replyCode == "4"){
				//connection.console.log(message);
				socket.write('5 '+ scriptId +'*SCRIPT*PLUGIN*COMPILE_STATUS GET ' + String.fromCharCode(0));
			}else if(replyCode == "5"){
				//connection.console.log(message);
				resolve(message)


				socket.end();
			}else if(replyCode == "6"){
				if(message == "<00000000-0000-0000-0000000000000000>"){
					if(containerId != ""){
						socket.write('9 '+ containerId +'*SCRIPT*STATUS GET ' + String.fromCharCode(0));
					}else{
						socket.write('7 '+ sceneId +'*TREE ADD TOP ' + String.fromCharCode(0));
					}
				} else {
					socket.write('2 SCENE NEW ' + String.fromCharCode(0));
				}

			}else if(replyCode == "7"){
				//connection.window.showInformationMessage("Answer: " + message)
				if(message == "1"){
					socket.write('8 '+ sceneId +'*TREE*/1*OBJECT_ID GET ' + String.fromCharCode(0));
				}
			}else if(replyCode == "8"){
				if(message.startsWith("#")){
					containerId = message;
				} else{
					reject("No container found")
					return;
				}
				socket.write('-1 '+ containerId +'*SCRIPT SET SCRIPT*Script ' + String.fromCharCode(0));
				socket.write('9 '+ containerId +'*SCRIPT*STATUS GET ' + String.fromCharCode(0));

			}else if(replyCode == "9"){
				if(scriptType == "Scene"){
					scriptId = sceneId;
				}else if(scriptType = "Container"){
					scriptId = containerId;
				}
				socket.write('-1 ' + scriptId +'*SCRIPT*PLUGIN STOP ' + String.fromCharCode(0));
				socket.write('3 '+ scriptId +'*SCRIPT*PLUGIN*SOURCE_CODE SET ' + text + ' ' + String.fromCharCode(0));

			}

		});

		socket.on('error', () => {
			reject("Not able to connect to Viz Engine " + host + ":" + port);
			sceneId = "";
			containerId = "";
		});

		socket.on('end', () => {

			//connection.console.log('Disconnected Viz Engine');
			//connection.window.showInformationMessage("Disconnected from Viz Engine");
		});
	});
}

export function compileScriptId(content: string, host: string, port: number, scriptType: string, scriptId: string, children: VizScriptObject[]){
	return new Promise((resolve, reject) => {
		if(scriptId == undefined){
			reject("No viz script associated with this script");
		}
		const socket = net.createConnection({ port: port, host: host}, () => {

			socket.write('1 MAIN*CONFIGURATION*COMMUNICATION*PROCESS_COMMANDS_ALWAYS GET ' + String.fromCharCode(0));
		});

		let text = content;
		let isReceivingData = false
		let replyCode = "-1"
		//connection.console.log('Script type is: ' + scriptType);

		socket.on('data', (data) => {
			let message = data.toString()

			if(!isReceivingData){
				replyCode = GetRegexResult(message, /^([^\s]+)(\s?)/gim)[1]
				message = message.slice(2)
				message = message.replace(String.fromCharCode(0), '')
			}

			if(replyCode == "1"){
				socket.write('-1 #' + scriptId +'*SCRIPT*PLUGIN STOP ' + String.fromCharCode(0));
				socket.write('3 #' + scriptId +'*SCRIPT*PLUGIN*SOURCE_CODE SET ' + text + ' ' + String.fromCharCode(0));
			}else if(replyCode == "3"){
				socket.write('4 #' + scriptId +'*SCRIPT*PLUGIN COMPILE ' + String.fromCharCode(0));
			}else if(replyCode == "4"){
				socket.write('5 #' + scriptId +'*SCRIPT*PLUGIN*COMPILE_STATUS GET ' + String.fromCharCode(0));
			}else if(replyCode == "5"){
				resolve(message)
				socket.end();
			}
		});

		socket.on('error', () => {
			reject("Not able to connect to Viz Engine " + host + ":" + port);
		});

		socket.on('end', () => {

			//connection.console.log('Disconnected Viz Engine');
			//connection.window.showInformationMessage("Disconnected from Viz Engine");
		});
	});
}

function GetRegexResult(line: string, regex: RegExp): string[] {
	let RegexString: RegExp = regex;
	return RegexString.exec(line);
}