import { LanguageClient } from "vscode-languageclient/node";
import { VizScriptObject } from "./shared/types";
import * as vscode from "vscode";

export interface MetadataStatus {
  status: "missing" | "valid" | "invalid" | "error";
  hasMetadata: boolean;
  isValid: boolean;
  errors: string[];
  metadata?: any;
}

export interface MetadataOperationResult {
  success: boolean;
  error?: string;
  metadata?: any;
  wasInjected?: boolean;
}

/**
 * Service class for handling metadata operations with the language server
 */
export class MetadataService {
  constructor(private client: LanguageClient) {}

  /**
   * Detects if metadata exists in a document
   */
  async detectMetadata(uri?: string): Promise<{ hasMetadata: boolean; metadata?: any; error?: string }> {
    try {
      return await this.client.sendRequest("detectMetadata", { uri });
    } catch (error) {
      return { hasMetadata: false, error: error.message };
    }
  }

  /**
   * Gets comprehensive metadata status for a document
   */
  async getMetadataStatus(uri?: string): Promise<MetadataStatus> {
    try {
      return await this.client.sendRequest("getMetadataStatus", { uri });
    } catch (error) {
      return {
        status: "error",
        hasMetadata: false,
        isValid: false,
        errors: [error.message],
      };
    }
  }

  /**
   * Updates metadata in a document
   */
  async updateMetadata(metadata: any, uri?: string): Promise<MetadataOperationResult> {
    try {
      return await this.client.sendRequest("updateMetadata", { metadata, uri });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Injects default metadata if missing
   */
  async injectDefaultMetadata(scriptObject?: VizScriptObject, uri?: string): Promise<MetadataOperationResult> {
    try {
      return await this.client.sendRequest("injectDefaultMetadata", { scriptObject, uri });
    } catch (error) {
      return { success: false, error: error.message, wasInjected: false };
    }
  }

  /**
   * Injects metadata into content with context information
   */
  async injectMetadataIntoContent(
    content: string,
    scriptObject: VizScriptObject,
    sourceContext: "viz" | "local" = "local",
  ): Promise<{ success: boolean; content: string; message?: string }> {
    try {
      const lines = content.split(/\r?\n/g);
      const hasMetadata = this.detectMetadataInLines(lines);

      if (hasMetadata) {
        return { success: false, content, message: "Metadata already exists in content" };
      }

      // Create metadata for the script
      const metadata = this.createDefaultMetadata(scriptObject);

      // Generate metadata block with appropriate context
      const metadataBlock = this.generateMetadataBlock(metadata, { sourceContext });

      // Insert metadata at the beginning
      const newContent = [...metadataBlock, "", ...lines].join("\n");

      return {
        success: true,
        content: newContent,
        message: `Metadata injected using ${sourceContext === "viz" ? "minified" : "standard"} format`,
      };
    } catch (error) {
      return {
        success: false,
        content,
        message: `Failed to inject metadata: ${error.message}`,
      };
    }
  }

  /**
   * Extracts metadata from provided content
   */
  async extractMetadataFromContent(content: string): Promise<{
    success: boolean;
    metadata?: any;
    error?: string;
  }> {
    try {
      const lines = content.split(/\r?\n/g);
      let inMetaSection = false;
      const metadataLines: string[] = [];

      for (const line of lines) {
        if (line.includes("VSCODE-META-START")) {
          inMetaSection = true;
          continue;
        }

        if (line.includes("VSCODE-META-END")) {
          inMetaSection = false;
          break;
        }

        if (inMetaSection) {
          // Remove leading quote if present
          const cleanLine = line.startsWith("'") ? line.substring(1) : line;
          metadataLines.push(cleanLine);
        }
      }

      if (metadataLines.length === 0) {
        return { success: false, error: "No metadata found" };
      }

      const metadataJson = metadataLines.join("\n");
      const metadata = JSON.parse(metadataJson);

      return { success: true, metadata };
    } catch (error) {
      return { success: false, error: `Failed to extract metadata: ${error.message}` };
    }
  }

  /**
   * Updates metadata in provided content and returns the modified content
   */
  async updateMetadataInContent(
    content: string,
    metadata: any,
  ): Promise<{
    success: boolean;
    content: string;
    error?: string;
  }> {
    try {
      // For now, we'll handle this client-side by using the server's logic
      const lines = content.split(/\r?\n/g);
      const updatedContent = this.updateMetadataInLines(lines, metadata);

      return {
        success: true,
        content: updatedContent.join("\n"),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        content,
      };
    }
  }

  /**
   * Client-side implementation of updating metadata in lines
   */
  private updateMetadataInLines(lines: string[], newMetadata: any): string[] {
    const newLines: string[] = [];
    let inMetaSection = false;
    let metadataReplaced = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes("VSCODE-META-START")) {
        inMetaSection = true;
        // Add the new metadata block
        newLines.push(...this.generateMetadataBlock(newMetadata, { sourceContext: "local" }));
        metadataReplaced = true;
        continue;
      }

      if (line.includes("VSCODE-META-END")) {
        inMetaSection = false;
        continue; // Skip the end line as it's included in generateMetadataBlock
      }

      if (!inMetaSection) {
        newLines.push(line);
      }
    }

    // If no metadata was found and replaced, add it at the beginning
    if (!metadataReplaced) {
      const metadataBlock = this.generateMetadataBlock(newMetadata, { sourceContext: "local" });
      return [...metadataBlock, "", ...lines];
    }

    return newLines;
  }

  /**
   * Generates properly formatted metadata block as string array
   */
  private generateMetadataBlock(metadata: any, options?: { minify?: boolean; sourceContext?: string }): string[] {
    const config = vscode.workspace.getConfiguration("vizscript.metadata");
    const minifyFormat = config.get<string>("minifyFormat", "none");

    let formatType = "multiline";

    // Determine format type based on configuration and context
    switch (minifyFormat) {
      case "both":
        formatType = "oneline";
        break;
      case "vizOnly":
        formatType = options?.sourceContext === "viz" ? "oneline" : "multiline";
        break;
      case "compact":
        formatType = "compact";
        break;
      case "none":
      default:
        formatType = "multiline";
        break;
    }

    const lines: string[] = [];
    const jsonString = JSON.stringify(metadata);

    if (formatType === "oneline") {
      // True single-line format: everything on one line
      lines.push(`'VSCODE-META-START${jsonString}VSCODE-META-END`);
    } else if (formatType === "compact") {
      // Compact 3-line format
      lines.push("'VSCODE-META-START");
      lines.push(`'${jsonString}`);
      lines.push("'VSCODE-META-END");
    } else {
      // Multi-line format (existing behavior)
      lines.push("'VSCODE-META-START");
      const prettyJsonString = JSON.stringify(metadata, null, 2);
      const jsonLines = prettyJsonString.split("\n");

      for (const line of jsonLines) {
        lines.push(`'${line}`);
      }
      lines.push("'VSCODE-META-END");
    }

    return lines;
  }

  /**
   * Processes script content for metadata before opening in editor
   * This is the main method that orchestrates the metadata workflow
   */
  async processScriptMetadata(
    scriptObject: VizScriptObject,
    scriptContent: string,
    options: {
      forcePrompt?: boolean;
      skipDialog?: boolean;
      autoInject?: boolean;
    } = {},
  ): Promise<{
    processedContent: string;
    metadataWasProcessed: boolean;
    action: "injected" | "updated" | "kept" | "skipped" | "error";
    error?: string;
  }> {
    try {
      // First, let's check if the content already has metadata
      const lines = scriptContent.split(/\r?\n/g);
      const hasMetadata = this.detectMetadataInLines(lines);

      if (!hasMetadata) {
        if (options.autoInject || options.skipDialog) {
          // Inject metadata directly
          const result = await this.injectDefaultMetadata(scriptObject);
          if (result.success && result.wasInjected) {
            return {
              processedContent: scriptContent, // Server will handle the injection
              metadataWasProcessed: true,
              action: "injected",
            };
          } else {
            return {
              processedContent: scriptContent,
              metadataWasProcessed: false,
              action: "error",
              error: result.error || "Failed to inject metadata",
            };
          }
        } else {
          // No metadata found - will be handled by the calling code to show dialog
          return {
            processedContent: scriptContent,
            metadataWasProcessed: false,
            action: "skipped",
          };
        }
      } else {
        // Metadata exists - check if we need to update it
        const status = await this.getMetadataStatus();

        if (!status.isValid && !options.skipDialog) {
          // Invalid metadata - will be handled by calling code
          return {
            processedContent: scriptContent,
            metadataWasProcessed: false,
            action: "error",
            error: `Invalid metadata: ${status.errors.join(", ")}`,
          };
        }

        if (options.forcePrompt && !options.skipDialog) {
          // Will be handled by calling code to show update dialog
          return {
            processedContent: scriptContent,
            metadataWasProcessed: false,
            action: "kept",
          };
        }

        // Metadata is valid and no prompt requested
        return {
          processedContent: scriptContent,
          metadataWasProcessed: true,
          action: "kept",
        };
      }
    } catch (error) {
      return {
        processedContent: scriptContent,
        metadataWasProcessed: false,
        action: "error",
        error: error.message,
      };
    }
  }

  /**
   * Helper method to detect metadata in content lines (client-side check)
   */
  private detectMetadataInLines(lines: string[]): boolean {
    let hasStart = false;
    let hasEnd = false;

    for (const line of lines) {
      if (line.includes("VSCODE-META-START")) {
        hasStart = true;
      }
      if (line.includes("VSCODE-META-END")) {
        hasEnd = true;
      }
      if (hasStart && hasEnd) {
        return true;
      }
    }

    return hasStart && hasEnd;
  }

  /**
   * Creates default metadata object for client-side operations
   */
  createDefaultMetadata(scriptObject: VizScriptObject): any {
    const now = this.formatLocalDateTime(new Date());

    const metadata: any = {
      UUID: this.generateUUID(),
      scenePath: scriptObject.scenePath || "",
      filePath: "", // Will be set when file is saved locally
      fileName: scriptObject.name || "untitled",
      scriptType: scriptObject.type || "Scene",
      lastModified: now,
    };

    // Add group flag for collections
    if (scriptObject.isGroup) {
      metadata.isGroup = true;
    }

    return this.sortMetadata(metadata);
  }

  /**
   * Generates a simple UUID for client-side use
   */
  public generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Merges current metadata with updates
   */
  mergeMetadata(existing: any, updates: any): any {
    const merged = { ...existing };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && value !== null) {
        merged[key] = value;
      }
    }

    // Always update lastModified when merging
    merged["lastModified"] = this.formatLocalDateTime(new Date());

    return this.sortMetadata(merged);
  }

  /**
   * Formats date in local timezone as DD/MM/YYYY HH:mm
   */
  public formatLocalDateTime(date: Date): string {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  /**
   * Sorts metadata fields in the desired order
   */
  private sortMetadata(metadata: any): any {
    const fieldOrder = ["UUID", "scenePath", "filePath", "fileName", "scriptType", "lastModified"];

    const sorted: any = {};

    // Add fields in the specified order
    for (const field of fieldOrder) {
      if (metadata.hasOwnProperty(field)) {
        sorted[field] = metadata[field];
      }
    }

    // Add any remaining fields that weren't in the ordered list
    for (const [key, value] of Object.entries(metadata)) {
      if (!fieldOrder.includes(key)) {
        sorted[key] = value;
      }
    }

    return sorted;
  }
}
