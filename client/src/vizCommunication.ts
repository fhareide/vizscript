/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as net from "net";
import { ExtensionContext, Progress, window, workspace } from "vscode";
import { loadFromStorage, saveToStorage } from "./commands";
import { SceneService } from "./sceneService";
import { FileService } from "./fileService";
import { MetadataService } from "./metadataService";
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
          const finalScriptName = scriptContent[0] === "" ? "NewScene" : scriptName;
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
        if (answer[3] === "") {
          // No container scripts found, but still return the scene script
          scriptObjects = [...sceneScript];
          await saveToStorage(context, scriptObjects);
          socket.end();
          return;
        }
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

          // Map to group script vizIds by normalized content
          const contentMap = new Map<string, string[]>(); // Map from normalized script content to array of vizIds

          // Create FileService instance for content normalization
          const fileService = new FileService();

          // Iterate over scriptObjects to populate scriptMap and contentMap
          for (const script of scriptObjects) {
            const vizId = script.vizId;
            // Normalize the script content for proper comparison
            const normalizedContent = fileService.normalizeForComparison(script.code);

            // Store script in scriptMap
            scriptMap.set(vizId, script);

            // Update contentMap to group vizIds by normalized content
            if (contentMap.has(normalizedContent)) {
              contentMap.get(normalizedContent).push(vizId);
            } else {
              contentMap.set(normalizedContent, [vizId]);
            }
          }

          // Prepare the final scriptObjects list with collections
          const finalScriptObjects = [];

          // Load existing collections from storage to preserve names
          const existingScripts = await loadFromStorage(context);
          const existingCollections = existingScripts.filter((s) => s.isGroup);

          console.log(
            "Existing collections:",
            existingCollections.map((c) => ({ name: c.name, vizId: c.vizId, children: c.children })),
          );

          // Helper to get collection name from metadata in open files or fetched script
          const getCollectionNameFromMetadata = (content: string): string | null => {
            try {
              // Normalize the collection content for comparison
              const normalizedCollectionContent = fileService.normalizeForComparison(content);

              console.log(`Checking for metadata in open documents and fetched script...`);

              // First, check open documents for matching content with metadata
              const allDocuments = workspace.textDocuments;

              for (const doc of allDocuments) {
                const docContent = doc.getText();

                // Extract metadata and script content from document
                const docLines = docContent.split(/\r?\n/g);
                let scriptStartIndex = 0;
                let inMetaSection = false;
                let metadataJson = "";

                // Parse metadata and find where script starts
                for (let i = 0; i < docLines.length; i++) {
                  const line = docLines[i];
                  if (line.includes("VSCODE-META-START") && line.includes("VSCODE-META-END")) {
                    const startIndex = line.indexOf("VSCODE-META-START") + "VSCODE-META-START".length;
                    const endIndex = line.indexOf("VSCODE-META-END");
                    if (startIndex < endIndex) {
                      metadataJson = line.substring(startIndex, endIndex);
                    }
                    scriptStartIndex = i + 1;
                    break;
                  } else if (line.includes("VSCODE-META-START")) {
                    inMetaSection = true;
                  } else if (line.includes("VSCODE-META-END")) {
                    inMetaSection = false;
                    scriptStartIndex = i + 1;
                    break;
                  } else if (inMetaSection) {
                    const cleanLine = line.startsWith("'") ? line.substring(1) : line;
                    metadataJson += cleanLine;
                  }
                }

                // Get script content without metadata
                const docScriptContent = docLines.slice(scriptStartIndex).join("\n");
                const normalizedDocContent = fileService.normalizeForComparison(docScriptContent);

                // Compare contents
                if (normalizedDocContent === normalizedCollectionContent) {
                  console.log(`Open document has matching content: ${doc.uri.fsPath}`);

                  if (metadataJson) {
                    try {
                      const metadata = JSON.parse(metadataJson);
                      if (metadata.isGroup && metadata.fileName) {
                        console.log(`Found metadata in open file with fileName: ${metadata.fileName}`);
                        return metadata.fileName;
                      }
                    } catch (parseError) {
                      console.log(`Error parsing metadata in open file:`, parseError);
                    }
                  }
                }
              }

              // If not found in open documents, check the fetched script content itself
              console.log(`Checking fetched script content for metadata...`);
              const lines = content.split(/\r?\n/g);
              let inMetaSection = false;
              let metadataJson = "";

              for (const line of lines) {
                if (line.includes("VSCODE-META-START") && line.includes("VSCODE-META-END")) {
                  const startIndex = line.indexOf("VSCODE-META-START") + "VSCODE-META-START".length;
                  const endIndex = line.indexOf("VSCODE-META-END");
                  if (startIndex < endIndex) {
                    metadataJson = line.substring(startIndex, endIndex);
                  }
                  break;
                } else if (line.includes("VSCODE-META-START")) {
                  inMetaSection = true;
                  continue;
                } else if (line.includes("VSCODE-META-END")) {
                  break;
                } else if (inMetaSection) {
                  const cleanLine = line.startsWith("'") ? line.substring(1) : line;
                  metadataJson += cleanLine;
                }
              }

              if (metadataJson) {
                try {
                  const metadata = JSON.parse(metadataJson);
                  if (metadata.isGroup && metadata.fileName) {
                    console.log(`Found metadata in fetched script with fileName: ${metadata.fileName}`);
                    return metadata.fileName;
                  }
                } catch (parseError) {
                  console.log(`Error parsing metadata in fetched script:`, parseError);
                }
              }

              console.log("No metadata with fileName found");
            } catch (error) {
              console.error("Error getting collection name from metadata:", error);
            }
            return null;
          };

          // Collection index counter - start from the max existing collection index + 1
          let collectionIndex = 0;
          if (existingCollections.length > 0) {
            // Find the highest collection index from existing collections
            const existingIndices = existingCollections
              .map((c) => {
                const match = c.vizId.match(/#c(\d+)/);
                return match ? parseInt(match[1], 10) : -1;
              })
              .filter((idx) => idx >= 0);

            if (existingIndices.length > 0) {
              collectionIndex = Math.max(...existingIndices) + 1;
            }
          }

          // Add scene script to the final list
          finalScriptObjects.push(...sceneScript);

          // Helper function to find matching existing collection
          const findMatchingCollection = (vizIds: string[]): VizScriptObject | undefined => {
            // Sort vizIds for comparison
            const sortedVizIds = [...vizIds].sort();

            console.log("Looking for collection with vizIds:", sortedVizIds);

            const match = existingCollections.find((collection) => {
              const sortedChildren = [...collection.children].sort();

              console.log(`  Comparing with ${collection.name} (${collection.vizId}):`, sortedChildren);

              // Check if the children arrays match
              if (sortedChildren.length !== sortedVizIds.length) {
                return false;
              }

              const isMatch = sortedChildren.every((childId, index) => childId === sortedVizIds[index]);
              console.log(`  Match result:`, isMatch);
              return isMatch;
            });

            if (match) {
              console.log(`Found matching collection: ${match.name} (${match.vizId})`);
            } else {
              console.log("No matching collection found");
            }

            return match;
          };

          // Iterate over contentMap to create collection script objects
          for (const [content, vizIds] of contentMap.entries()) {
            if (vizIds.length > 1) {
              // Try to find an existing collection with the same children
              const existingCollection = findMatchingCollection(vizIds);

              // Try to get name from metadata in the fetched script content
              const metadataName = getCollectionNameFromMetadata(content);
              console.log("Metadata name:", metadataName);

              // Determine the collection name priority:
              // For collections (no filePath), the metadata from the fetched script is the master.
              // This ensures that if a user renames a collection and pushes to Viz,
              // the next fetch will pick up the correct name from the metadata.
              // Priority:
              // 1. Metadata fileName (from fetched Viz script - the source of truth)
              // 2. Existing collection name (fallback if no metadata in Viz)
              // 3. Default Collection{index}
              const collectionName = metadataName || existingCollection?.name || `Collection${collectionIndex}`;

              // Create a collection for similar scripts
              const collectionScript: VizScriptObject = {
                vizId: existingCollection?.vizId || `#c${collectionIndex}`,
                type: `ContainerCollection ( x${vizIds.length} )`,
                extension: ".vsc",
                name: collectionName,
                code: scriptMap.get(vizIds[0]).code, // Use the code of the first script as an example
                scenePath: scenePath,
                children: vizIds,
                isGroup: true, // Mark as a group
              };

              console.log(
                `Created collection: ${collectionScript.name} (${collectionScript.vizId}) with children:`,
                vizIds,
              );

              finalScriptObjects.push(collectionScript);

              // Only increment if we created a new collection (not reusing an existing one)
              if (!existingCollection) {
                collectionIndex++;
              }
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
              "Continue",
              "Cancel",
            )
            .then((choice) => {
              if (choice === "Continue") {
                socket.write("-1 " + scriptId + "*SCRIPT*PLUGIN STOP " + String.fromCharCode(0));
                socket.write("3 " + scriptId + "*SCRIPT*PLUGIN*SOURCE_CODE SET " + text + " " + String.fromCharCode(0));
              } else {
                socket.end();
                return;
              }
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
