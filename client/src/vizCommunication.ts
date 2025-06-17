/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as net from "net";
import { ExtensionContext, Progress, window } from "vscode";
import { loadFromStorage, saveToStorage } from "./commands";
import { TreeService } from "./treeService";
import type { VizScriptObject } from "./shared/types";

let sceneId = "";
let containerId = "";
let scriptId = "";

function cleanString(str: string): string {
  return str.replace(/[\x00-\x1F\x7F]/g, "").trim();
}

//Get all scripts from Viz Engine with tree structure
export function getVizScripts(
  host: string,
  port: number,
  context: ExtensionContext,
  layer: string,
  progress?: Progress<{
    message?: string;
    increment?: number;
  }>,
): Promise<VizScriptObject[]> {
  return new Promise((resolve, reject) => {
    let currentObjectId = "";
    let scenePath = "";
    let sceneScript = new Array<VizScriptObject>();
    let scriptObjects = new Array<VizScriptObject>();

    const socket = net.createConnection({ port: port, host: host }, () => {
      socket.write("1 MAIN IS_ON_AIR " + String.fromCharCode(0));
    });

    socket.on("data", async (data) => {
      let message = data.toString().replace(String.fromCharCode(0), "");
      let answer = GetRegexResult(message, /^([^\s]+)(\s?)(.*)/gi);

      if (answer[1] == "1") {
        socket.write("UUID " + layer + "*UUID GET " + String.fromCharCode(0));
      } else if (answer[1] == "UUID") {
        if (answer[3].startsWith("ERROR")) {
          console.log("No scene found in " + layer);
          socket.end();
          return;
        }
        socket.write("PATH FILENAME_FROM_UUID GET " + answer[3] + String.fromCharCode(0));
      } else if (answer[1] == "PATH") {
        if (answer[3].startsWith("ERROR")) {
          console.log("No UUID found in " + layer);
          socket.end();
          return;
        }
        scenePath = answer[3];
        socket.write("2 " + layer + "*OBJECT_ID GET " + String.fromCharCode(0));
      } else if (answer[1] == "2") {
        if (answer[3].startsWith("ERROR")) {
          console.log("No object ID found in " + layer);
          socket.end();
          return;
        }
        currentObjectId = answer[3];
        context.workspaceState.update("currentSceneId", currentObjectId);
        context.workspaceState.update("currentScenePath", scenePath);
        try {
          const scriptContent = await getVizScriptContent(host, port, currentObjectId);
          const cleanName = cleanString(scriptContent[1]);
          const scriptName = cleanName.startsWith("#") ? "Unsaved Scene" : cleanName;
          const finalScriptName = scriptContent[0] === "" ? "No scene script found" : scriptName;
          const script: VizScriptObject = {
            vizId: currentObjectId,
            type: "Scene",
            extension: ".vs",
            name: finalScriptName,
            code: scriptContent[0],
            scenePath: scenePath,
            children: [],
          };
          sceneScript.push(script);
          progress &&
            progress.report({ increment: 10, message: "Scene script fetched. Searching for container scripts..." });
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
          // Fetch all script contents
          await Promise.all(
            containerScriptVizIds.map(async (scriptVizId, index) => {
              const code = await getVizScriptContent(host, port, scriptVizId);

              const script: VizScriptObject = {
                vizId: scriptVizId,
                type: "Container",
                extension: ".vsc",
                name: cleanString(code[1]),
                code: code[0],
                scenePath: scenePath,
                children: [],
              };

              scriptObjects.push(script);
              progress && progress.report({ increment: increment * index, message: "Container script fetched" });
            }),
          );

          // Map to store scripts by vizId
          const scriptMap = new Map<string, VizScriptObject>();

          // Map to group script vizIds by content
          const contentMap = new Map<string, string[]>(); // Map from script content to array of vizIds

          // Iterate over scriptObjects to populate scriptMap and contentMap
          for (const script of scriptObjects) {
            const vizId = script.vizId;
            const scriptContent = script.code;

            // Store script in scriptMap
            scriptMap.set(vizId, script);

            // Update contentMap to group vizIds by content
            if (contentMap.has(scriptContent)) {
              contentMap.get(scriptContent).push(vizId);
            } else {
              contentMap.set(scriptContent, [vizId]);
            }
          }

          // Prepare the final scriptObjects list with collections
          const finalScriptObjects = [];

          // Collection index counter
          let collectionIndex = 0;

          // Add scene script to the final list
          finalScriptObjects.push(...sceneScript);

          // Iterate over contentMap to create collection script objects
          for (const [content, vizIds] of contentMap.entries()) {
            if (vizIds.length > 1) {
              // Create a collection for similar scripts
              const collectionScript: VizScriptObject = {
                vizId: `#c${collectionIndex}`,
                type: `ContainerCollection ( x${vizIds.length} )`,
                extension: ".vsc",
                name: `Collection${collectionIndex}`, // Keeping the original name for simplicity
                code: scriptMap.get(vizIds[0]).code, // Use the code of the first script as an example
                scenePath: scenePath,
                children: vizIds,
                isGroup: true, // Mark as a group
              };
              finalScriptObjects.push(collectionScript);
              collectionIndex++; // Increment the collection index after creating a collection
            } else {
              // If only one script with this content, add it as is
              const singleScript = scriptMap.get(vizIds[0]); // Use the first vizId as an example
              finalScriptObjects.push(singleScript);
            }
          }

          // Replace scriptObjects with the final list
          scriptObjects = finalScriptObjects;

          console.log("Scripts fetched successfully without tree path enrichment");

          // Do something with scriptObjects, e.g., send them back to the client
          await saveToStorage(context, scriptObjects);

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
      resolve(scriptObjects);
    });
  });
}

//Get all scripts from workspace storage file
export function getScriptObjectCache(context: ExtensionContext): Promise<any> {
  return loadFromStorage(context)
    .then((scriptObjectCache) => {
      if (scriptObjectCache === undefined) {
        return [];
      } else {
        return scriptObjectCache;
      }
    })
    .catch((error) => {
      return Promise.reject(error);
    });
}

//Get script content from Viz Engine
function getVizScriptContent(host: string, port: number, vizId: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let code = "";
    let name = "";

    const socket = net.createConnection({ port, host }, () => {
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
      reject("Not able to connect to Viz Engine " + host + ":" + port);
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

export function compileScriptId(
  context: ExtensionContext,
  content: string,
  host: string,
  port: number,
  scriptId: string,
  selectedLayer: string,
) {
  return new Promise((resolve, reject) => {
    if (scriptId == undefined) {
      reject("No viz script associated with this script");
    }

    /*     const socket = net.createConnection({ port: port, host: host }, () => {
      socket.write("1 MAIN*CONFIGURATION*COMMUNICATION*PROCESS_COMMANDS_ALWAYS GET " + String.fromCharCode(0));
    }); */

    const socket = net.createConnection({ port: port, host: host }, () => {
      socket.write("1 " + selectedLayer + "*OBJECT_ID GET " + String.fromCharCode(0));
    });

    //check if the vizid is #c01, #c02, etc
    if (scriptId.startsWith("#c")) {
      getScriptObjectCache(context)
        .then((scriptObjects) => {
          if (Array.isArray(scriptObjects)) {
            let vizIdPromises = scriptObjects.map((scriptObject) => {
              if (scriptObject.vizId === scriptId) {
                return Promise.resolve(scriptObject.children);
              }
              return Promise.resolve([]);
            });

            // Execute all vizId promises concurrently
            return Promise.all(vizIdPromises);
          } else {
            throw new Error("Script objects are not iterable or are undefined");
          }
        })
        .then((vizIdArrays) => {
          // Flatten array of arrays into a single array of vizIds
          let vizIds = vizIdArrays.reduce((acc, val) => acc.concat(val), []);

          // Compile each script in the collection
          let compilePromises = vizIds.map((vizId) => {
            return compileScriptId(context, content, host, port, vizId, selectedLayer);
          });

          // Wait for all compilations to complete
          return Promise.all(compilePromises);
        })
        .then(() => {
          // All scripts in the collection have been compiled
          resolve("All scripts compiled successfully");
        })
        .catch((error) => {
          reject(error);
        });
      return;
    }

    let text = content;
    let replyCode = "-1";
    //connection.console.log('Script type is: ' + scriptType);

    socket.on("data", (data) => {
      let message = data.toString().replace(String.fromCharCode(0), "");
      let answer = GetRegexResult(message, /^([^\s]+)(\s?)(.*)/gi);
      replyCode = answer[1];

      if (replyCode == "1") {
        // Get the current scene UUID from the targeted layer
        if (answer[3].startsWith("ERROR") || answer[3] === "<00000000-0000-0000-0000000000000000>") {
          window.showErrorMessage(`No scene loaded in ${selectedLayer}. Please load a scene first.`);
          socket.end();
          return;
        }

        // Get scene path from the current scene in the targeted layer
        socket.write("PATH FILENAME_FROM_UUID GET " + answer[3] + String.fromCharCode(0));
      } else if (replyCode == "PATH") {
        if (answer[3].startsWith("ERROR")) {
          window.showErrorMessage("Unable to get scene path from the current scene. Please try again.");
          socket.end();
          return;
        }

        // The current scene path in the targeted layer
        const currentScenePath = answer[3];

        // Get the expected scene path from script metadata if available
        const cachedScenePath = context.workspaceState.get("currentScenePath");

        console.log(`Scene validation - Cached: "${cachedScenePath}", Current: "${currentScenePath}"`);

        // Only validate if we have both scene paths and they're different
        if (cachedScenePath && currentScenePath && cachedScenePath !== currentScenePath) {
          window
            .showWarningMessage(
              `Scene mismatch detected!`,
              {
                modal: true,
                detail: `Script was fetched from: ${cachedScenePath}\nCurrent scene in ${selectedLayer}: ${currentScenePath}\n\nDo you want to continue anyway?`,
              },
              "Continue Anyway",
              "Cancel",
            )
            .then((choice) => {
              if (choice !== "Continue Anyway") {
                socket.end();
                return;
              }

              socket.write("-1 " + scriptId + "*SCRIPT*PLUGIN STOP " + String.fromCharCode(0));
              socket.write("3 " + scriptId + "*SCRIPT*PLUGIN*SOURCE_CODE SET " + text + " " + String.fromCharCode(0));
            });
        } else {
          socket.write("-1 " + scriptId + "*SCRIPT*PLUGIN STOP " + String.fromCharCode(0));
          socket.write("3 " + scriptId + "*SCRIPT*PLUGIN*SOURCE_CODE SET " + text + " " + String.fromCharCode(0));
        }
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
