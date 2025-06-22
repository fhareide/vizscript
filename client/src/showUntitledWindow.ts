import * as vscode from "vscode";
import uuidByString from "uuid-by-string";

// Map to track untitled documents by vizscript ID
const untitledDocuments = new Map<string, vscode.TextDocument>();

export async function showUntitledWindow(
  id: string,
  name: string,
  fileExtension: string,
  content: string,
  context: vscode.ExtensionContext,
  scriptObject?: any,
) {
  const filetype = fileExtension === ".vs" ? "viz" : "viz-con";

  // Generate deterministic UUID based on vizId for new untitled documents
  // This matches createDefaultMetadata behavior for new scripts
  const vizIdForUuid = scriptObject?.vizId || id;
  const deterministicUuid = uuidByString(`vizscript-${vizIdForUuid}`);
  const filename = `${name}-${deterministicUuid.substring(0, 8)}${fileExtension}`;

  // Check if we already have an untitled document for this script
  const existingDocument = untitledDocuments.get(id);
  if (existingDocument) {
    // Check if document is still open by checking if it's in the workspace documents
    const isDocumentStillOpen = vscode.workspace.textDocuments.includes(existingDocument);

    if (isDocumentStillOpen) {
      // Document is still open, focus it and update content if needed
      const editor = await vscode.window.showTextDocument(existingDocument);
      if (existingDocument.getText() !== content) {
        await editor.edit((editBuilder) => {
          const fullRange = new vscode.Range(
            existingDocument.positionAt(0),
            existingDocument.positionAt(existingDocument.getText().length),
          );
          editBuilder.replace(fullRange, content);
        });
      }
      return editor;
    } else {
      // Document was closed, remove from map
      untitledDocuments.delete(id);
    }
  }

  // Check if content already has metadata and extract it completely
  const lines = content.split(/\r?\n/g);
  let contentWithoutMetadata = content;
  let existingMetadata: any = null;

  // Extract existing metadata and remove it from content
  let inMetaSection = false;
  const filteredLines: string[] = [];
  const metadataLines: string[] = [];

  for (const line of lines) {
    if (line.includes("VSCODE-META-START") && line.includes("VSCODE-META-END")) {
      // Single-line metadata format
      const startIndex = line.indexOf("VSCODE-META-START") + "VSCODE-META-START".length;
      const endIndex = line.indexOf("VSCODE-META-END");
      if (startIndex < endIndex) {
        const jsonContent = line.substring(startIndex, endIndex);
        try {
          existingMetadata = JSON.parse(jsonContent);
        } catch (error) {
          // Ignore parsing errors
        }
      }
      continue;
    } else if (line.includes("VSCODE-META-START")) {
      inMetaSection = true;
      continue;
    } else if (line.includes("VSCODE-META-END")) {
      inMetaSection = false;
      // Parse multi-line metadata
      try {
        const metadataJson = metadataLines.join("\n");
        existingMetadata = JSON.parse(metadataJson);
      } catch (error) {
        // Ignore parsing errors
      }
      continue;
    } else if (inMetaSection) {
      const cleanLine = line.startsWith("'") ? line.substring(1) : line;
      metadataLines.push(cleanLine);
    } else {
      filteredLines.push(line);
    }
  }

  contentWithoutMetadata = filteredLines.join("\n");

  // Helper function to format date in local timezone as DD/MM/YYYY HH:mm
  function formatLocalDateTime(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  // Helper function to determine viz version from file extension
  function getVizVersionFromExtension(extension: string): string {
    const ext = extension.toLowerCase();
    if (ext.includes("4")) return "viz4";
    if (ext.includes("5")) return "viz5";
    return "viz3";
  }

  let finalMetadata: any;

  if (existingMetadata) {
    // Use existing metadata, but ensure filePath is empty for untitled
    finalMetadata = {
      ...existingMetadata,
      filePath: "", // Clear filePath for untitled documents
    };
  } else {
    // No existing metadata - create new metadata
    // Generate deterministic UUID based on vizId for new untitled documents
    // This matches createDefaultMetadata behavior for new scripts
    const vizIdForUuid = scriptObject?.vizId || id;
    const deterministicUuid = uuidByString(`vizscript-${vizIdForUuid}`);

    // Determine viz version from file extension
    const vizVersion = getVizVersionFromExtension(fileExtension);

    finalMetadata = {
      UUID: deterministicUuid,
      scenePath: scriptObject?.scenePath || "",
      filePath: "", // Will be set when file is saved locally
      fileName: scriptObject?.name || name || "untitled",
      scriptType: scriptObject?.type || (fileExtension === ".vs" ? "Scene" : "Container"),
      vizVersion: vizVersion,
    };

    // Add group flag for collections (matching createDefaultMetadata logic)
    if (scriptObject?.isGroup) {
      finalMetadata.isGroup = true;
    }
  }

  // Sort metadata fields in the same order as MetadataService
  const fieldOrder = ["UUID", "scenePath", "filePath", "fileName", "scriptType", "vizVersion"];
  const sortedMetadata: any = {};

  // Add fields in the specified order
  for (const field of fieldOrder) {
    if (finalMetadata.hasOwnProperty(field)) {
      sortedMetadata[field] = finalMetadata[field];
    }
  }

  // Add any remaining fields that weren't in the ordered list
  for (const [key, value] of Object.entries(finalMetadata)) {
    if (!fieldOrder.includes(key)) {
      sortedMetadata[key] = value;
    }
  }

  // Format metadata as multi-line for better readability and parsing
  const metadataJson = JSON.stringify(sortedMetadata, null, 2);
  const formattedMetadataLines = [
    "'VSCODE-META-START",
    ...metadataJson.split("\n").map((line) => `'${line}`),
    "'VSCODE-META-END",
    "",
  ];

  const contentWithMetadata = formattedMetadataLines.join("\n") + contentWithoutMetadata;

  // Create a proper untitled document
  const document = await vscode.workspace.openTextDocument({
    content: contentWithMetadata,
    language: filetype,
  });

  // Track this document
  untitledDocuments.set(id, document);

  // Show the document
  const editor = await vscode.window.showTextDocument(document);

  // Intercept save operations to force "Save As" for our untitled documents
  const saveDisposable = vscode.workspace.onWillSaveTextDocument(async (event) => {
    if (untitledDocuments.get(id) === event.document) {
      // This is our untitled document being saved - force "Save As" instead
      event.waitUntil(
        new Promise<vscode.TextEdit[]>(async (resolve, reject) => {
          try {
            // Get workspace folder for default save location
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const defaultUri =
              workspaceFolders && workspaceFolders.length > 0
                ? vscode.Uri.joinPath(workspaceFolders[0].uri, filename)
                : vscode.Uri.file(filename);

            // Show Save As dialog with workspace as default location
            const saveUri = await vscode.window.showSaveDialog({
              defaultUri: defaultUri,
              filters: {
                "Viz Scripts": [fileExtension.replace(".", "")],
              },
            });

            if (saveUri) {
              // User chose a location, save the content
              const content = event.document.getText();
              await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, "utf8"));

              // Open the newly saved file
              const newDocument = await vscode.workspace.openTextDocument(saveUri);
              await vscode.window.showTextDocument(newDocument);

              // Clean up tracking and close untitled document
              untitledDocuments.delete(id);
              await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

              // Resolve with empty edits
              resolve([]);
            } else {
              // User cancelled - reject to cancel the save
              reject(new Error("Save cancelled by user"));
            }
          } catch (error) {
            console.log("Save As cancelled or error occurred:", error);
            reject(error);
          }
        }),
      );
    }
  });

  // Clean up when document is closed
  const closeDisposable = vscode.workspace.onDidCloseTextDocument((closedDoc) => {
    if (untitledDocuments.get(id) === closedDoc) {
      untitledDocuments.delete(id);
      saveDisposable.dispose();
      closeDisposable.dispose();
    }
  });

  context.subscriptions.push(saveDisposable, closeDisposable);

  return editor;
}
