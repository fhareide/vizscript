/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as Commands from './commands';
import * as path from 'path';
import { workspace, ExtensionContext, commands, window } from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind
} from 'vscode-languageclient';

let client: LanguageClient;

function registerCommands(client: LanguageClient, context: ExtensionContext) {
	context.subscriptions.push(
		commands.registerTextEditorCommand('vizscript.openfile', Commands.displayScriptSelector.bind(this, context, client)),
		commands.registerTextEditorCommand('vizscript.compile', Commands.compileCurrentScript.bind(this, context, client)),
		//workspace.onDidChangeTextDocument(() => commands.executeCommand('vizscript.compile'))
		
	  //commands.registerCommand('apiElements.apiary.fetchApi', Commands.fetchApi.bind(this, context)),
	);
}

function registerNotifications(client: LanguageClient) {
  client.onNotification("requestCompile", () =>
    commands.executeCommand("vizscript.compile")
	);
}

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	let serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

	// The debug options for the server
	// --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
	let debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

	// If the extension is launched in debug mode then the debug server options are used
	// Otherwise the run options are used
	let serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
	};

	// Add client side commands
	//const command = 'vizscript.test';

  //const commandHandler = (name: string = 'world') => {
  //  window.showInformationMessage(`Hello ${name}!!!`);
  //};

  //context.subscriptions.push(commands.registerCommand(command, commandHandler));


	// Options to control the language client
	let clientOptions: LanguageClientOptions = {
		// Register the server for viz documents
		documentSelector: ['viz', 'viz-con'],
		
		synchronize: {
			// Notify the server about file changes to '.clientrc files contained in the workspace
			fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient('vizscript','VizScript',serverOptions,clientOptions);

	client.onReady().then(() => {
		registerCommands(client, context);
		registerNotifications(client);
	  });
	// Start the client. This will also launch the server

	context.subscriptions.push(client.start());
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
