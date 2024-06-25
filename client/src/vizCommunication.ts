/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as net from "net";
import { window, Range, Progress, ExtensionContext } from "vscode";
import { VizScriptObject } from "./vizScriptObject";

let sceneId = "";
let containerId = "";
let scriptId = "";

let thisHost = "";
let thisPort: number = -1;

let scriptObjectCache: VizScriptObject[];

function cleanString(str: string): string {
  return str.replace(/[\x00-\x1F\x7F]/g, "").trim();
}

export function getVizScripts(
  host: string,
  port: number,
  context: ExtensionContext,
  progress?: Progress<{
    message?: string;
    increment?: number;
  }>,
): Promise<VizScriptObject[]> {
  return new Promise((resolve, reject) => {
    let currentObjectId = "";
    thisHost = host;
    thisPort = port;
    let scriptObjects = new Array<VizScriptObject>();

    const socket = net.createConnection({ port: port, host: host }, () => {
      socket.write("1 MAIN IS_ON_AIR " + String.fromCharCode(0));
    });

    socket.on("data", async (data) => {
      let message = data.toString().replace(String.fromCharCode(0), "");
      let answer = GetRegexResult(message, /^([^\s]+)(\s?)(.*)/gi);

      if (answer[1] == "1") {
        socket.write("2 MAIN_SCENE*OBJECT_ID GET " + String.fromCharCode(0));
      } else if (answer[1] == "2") {
        currentObjectId = answer[3];
        try {
          const scriptContent = await getVizScriptContent(currentObjectId);
          const script: VizScriptObject = {
            vizId: currentObjectId,
            type: "Scene",
            extension: ".vs",
            name: cleanString(scriptContent[1]),
            code: scriptContent[0],
            location: "",
          };
          scriptObjects.push(script);
          progress &&
            progress.report({ increment: 10, message: "Scene script fetched. Fetching container scripts..." });
          socket.write(
            "3 " + currentObjectId + "*TREE SEARCH_FOR_CONTAINER_WITH_PROPERTY SCRIPT " + String.fromCharCode(0),
          );
        } catch (error) {
          window.showErrorMessage("Failed " + error.message);
        }
      } else if (answer[1] == "3") {
        if (answer[3] === "") socket.end();
        const containerScriptVizIds = answer[3].split(" ");

        const increment = 90 / containerScriptVizIds.length;

        try {
          await Promise.all(
            containerScriptVizIds.map(async (scriptVizId, index) => {
              const code = await getVizScriptContent(scriptVizId);

              const script: VizScriptObject = {
                vizId: scriptVizId,
                type: "Container",
                extension: ".vsc",
                name: cleanString(code[1]),
                code: code[0],
                location: "",
              };

              console.log(script);
              scriptObjects.push(script);
              progress && progress.report({ increment: increment * index, message: "Container script fetched" });
            }),
          );

          socket.end();
        } catch (error) {
          window.showErrorMessage("Failed " + error.message);
        }
      }
    });

    socket.on("error", () => {
      currentObjectId = "";
      reject("Not able to connect to Viz Engine " + host + ":" + port);
    });

    socket.on("end", () => {
      console.log("Disconnected Viz Engine");
      context.workspaceState.update("vizScripts", scriptObjects);
      resolve(scriptObjects);
    });
  });
}

export function getScriptObjectCache(): VizScriptObject[] {
  return scriptObjectCache;
}

function getVizScriptContent(vizId: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let code = "";
    let name = "";

    const socket = net.createConnection({ port: thisPort, host: thisHost }, () => {
      socket.write("1 MAIN*CONFIGURATION*COMMUNICATION*PROCESS_COMMANDS_ALWAYS GET " + String.fromCharCode(0));
    });

    let isReceivingData = false;
    let replyCode = "-1";

    socket.on("data", (data) => {
      let message = data.toString();

      if (!isReceivingData) {
        replyCode = GetRegexResult(message, /^([^\s]+)(\s?)/gim)[1];
        message = message.slice(2);
        message.replace(String.fromCharCode(0), "");
      }

      if (replyCode == "1") {
        if (message == "0") {
          reject("PROCESS_COMMANDS_ALWAYS not set to 1 in configuration");
        }
        if (vizId != "") {
          socket.write("2 " + vizId + "*NAME GET " + String.fromCharCode(0));
        }
      } else if (replyCode == "2") {
        name = message;
        socket.write("3 " + vizId + "*SCRIPT*PLUGIN*SOURCE_CODE GET " + String.fromCharCode(0));
      } else if (replyCode == "3") {
        isReceivingData = true;

        if (message.endsWith(String.fromCharCode(0))) {
          message = message.slice(0, message.length - 2);
          isReceivingData = false;
          socket.end();
        }
        code += message;
      }
    });

    socket.on("error", () => {
      reject("Not able to connect to Viz Engine " + thisHost + ":" + thisPort);
    });

    socket.on("end", () => {
      console.log("Disconnected Viz Engine");
      resolve([code, name]);
    });
  });
}

export function compileScript(content: string, host: string, port: number, scriptType: string) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port: port, host: host }, () => {
      socket.write("1 MAIN*CONFIGURATION*COMMUNICATION*PROCESS_COMMANDS_ALWAYS GET " + String.fromCharCode(0));
    });

    let text = content;
    let isReceivingData = false;
    let replyCode = "-1";
    //connection.console.log('Script type is: ' + scriptType);

    socket.on("data", (data) => {
      let message = data.toString();

      if (!isReceivingData) {
        replyCode = GetRegexResult(message, /^([^\s]+)(\s?)/gim)[1];
        message = message.slice(2);
        message = message.replace(String.fromCharCode(0), "");
      }

      if (replyCode == "1") {
        //connection.console.log("Viz Engine is OnAir");
        if (sceneId == "") {
          socket.write("2 SCENE NEW " + String.fromCharCode(0));
        } else {
          socket.write("6 " + sceneId + "*UUID GET " + String.fromCharCode(0));
        }
      } else if (replyCode == "2") {
        sceneId = message.replace("SCENE*", "");
        socket.write("7 " + sceneId + "*TREE ADD TOP " + String.fromCharCode(0));
      } else if (replyCode == "3") {
        //connection.console.log(message);
        socket.write("4 " + scriptId + "*SCRIPT*PLUGIN COMPILE " + String.fromCharCode(0));
      } else if (replyCode == "4") {
        //connection.console.log(message);
        socket.write("5 " + scriptId + "*SCRIPT*PLUGIN*COMPILE_STATUS GET " + String.fromCharCode(0));
      } else if (replyCode == "5") {
        //connection.console.log(message);
        resolve(message);

        socket.end();
      } else if (replyCode == "6") {
        if (message == "<00000000-0000-0000-0000000000000000>") {
          if (containerId != "") {
            socket.write("9 " + containerId + "*SCRIPT*STATUS GET " + String.fromCharCode(0));
          } else {
            socket.write("7 " + sceneId + "*TREE ADD TOP " + String.fromCharCode(0));
          }
        } else {
          socket.write("2 SCENE NEW " + String.fromCharCode(0));
        }
      } else if (replyCode == "7") {
        //connection.window.showInformationMessage("Answer: " + message)
        if (message == "1") {
          socket.write("8 " + sceneId + "*TREE*/1*OBJECT_ID GET " + String.fromCharCode(0));
        }
      } else if (replyCode == "8") {
        if (message.startsWith("#")) {
          containerId = message;
        } else {
          reject("No container found");
          return;
        }
        socket.write("-1 " + containerId + "*SCRIPT SET SCRIPT*Script " + String.fromCharCode(0));
        socket.write("9 " + containerId + "*SCRIPT*STATUS GET " + String.fromCharCode(0));
      } else if (replyCode == "9") {
        if (scriptType == "Scene") {
          scriptId = sceneId;
        } else if ((scriptType = "Container")) {
          scriptId = containerId;
        }
        socket.write("-1 " + scriptId + "*SCRIPT*PLUGIN STOP " + String.fromCharCode(0));
        socket.write("3 " + scriptId + "*SCRIPT*PLUGIN*SOURCE_CODE SET " + text + " " + String.fromCharCode(0));
      }
    });

    socket.on("error", () => {
      reject("Not able to connect to Viz Engine " + host + ":" + port);
      sceneId = "";
      containerId = "";
    });

    socket.on("end", () => {
      //connection.console.log('Disconnected Viz Engine');
      //connection.window.showInformationMessage("Disconnected from Viz Engine");
    });
  });
}

export function compileScriptId(content: string, host: string, port: number, scriptType: string, scriptId: string) {
  return new Promise((resolve, reject) => {
    if (scriptId == undefined) {
      reject("No viz script associated with this script");
    }
    const socket = net.createConnection({ port: port, host: host }, () => {
      socket.write("1 MAIN*CONFIGURATION*COMMUNICATION*PROCESS_COMMANDS_ALWAYS GET " + String.fromCharCode(0));
    });

    let text = content;
    let isReceivingData = false;
    let replyCode = "-1";
    //connection.console.log('Script type is: ' + scriptType);

    socket.on("data", (data) => {
      let message = data.toString();

      if (!isReceivingData) {
        replyCode = GetRegexResult(message, /^([^\s]+)(\s?)/gim)[1];
        message = message.slice(2);
        message = message.replace(String.fromCharCode(0), "");
      }

      if (replyCode == "1") {
        socket.write("-1 " + scriptId + "*SCRIPT*PLUGIN STOP " + String.fromCharCode(0));
        socket.write("3 " + scriptId + "*SCRIPT*PLUGIN*SOURCE_CODE SET " + text + " " + String.fromCharCode(0));
      } else if (replyCode == "3") {
        socket.write("4 " + scriptId + "*SCRIPT*PLUGIN COMPILE " + String.fromCharCode(0));
      } else if (replyCode == "4") {
        socket.write("5 " + scriptId + "*SCRIPT*PLUGIN*COMPILE_STATUS GET " + String.fromCharCode(0));
      } else if (replyCode == "5") {
        resolve(message);
        socket.end();
      }
    });

    socket.on("error", () => {
      window.showErrorMessage("Not able to connect to Viz Engine " + host + ":" + port);
      reject("Not able to connect to Viz Engine " + host + ":" + port);
    });

    socket.on("end", () => {
      //connection.console.log('Disconnected Viz Engine');
      //connection.window.showInformationMessage("Disconnected from Viz Engine");
    });
  });
}

function GetRegexResult(line: string, regex: RegExp): string[] {
  let RegexString: RegExp = regex;
  return RegexString.exec(line) as string[];
}
