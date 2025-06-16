import { LanguageClient } from "vscode-languageclient/node";
import { VizScriptObject } from "./shared/types";

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
   * Injects metadata into provided content and returns the modified content
   * This is useful for processing content before opening a new document
   */
  async injectMetadataIntoContent(
    content: string,
    scriptObject?: VizScriptObject,
  ): Promise<{
    success: boolean;
    wasInjected: boolean;
    content: string;
    metadata?: any;
    error?: string;
  }> {
    try {
      return await this.client.sendRequest("injectMetadataIntoContent", { content, scriptObject });
    } catch (error) {
      return {
        success: false,
        error: error.message,
        wasInjected: false,
        content,
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
        newLines.push(...this.generateMetadataBlock(newMetadata));
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
      const metadataBlock = this.generateMetadataBlock(newMetadata);
      return [...metadataBlock, "", ...lines];
    }

    return newLines;
  }

  /**
   * Generates properly formatted metadata block as string array
   */
  private generateMetadataBlock(metadata: any): string[] {
    const lines: string[] = [];
    lines.push("'VSCODE-META-START");

    const jsonString = JSON.stringify(metadata, null, 2);
    const jsonLines = jsonString.split("\n");

    for (const line of jsonLines) {
      lines.push(`'${line}`);
    }

    lines.push("'VSCODE-META-END");

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
    const now = new Date().toISOString();

    const metadata: any = {
      scenePath: scriptObject.scenePath || "",
      filePath: "", // Will be set when file is saved locally
      fileName: scriptObject.name || "untitled",
      UUID: this.generateUUID(),
      scriptType: scriptObject.type || "Scene",
      vizId: scriptObject.vizId || "",
      lastModified: now,
      version: "1.0.0",
      author: "VSCode User",
      description: `Auto-generated metadata for ${scriptObject.name || "script"}`,
    };

    // Only add treePath for container scripts
    if (scriptObject.type === "Container" && scriptObject.treePath) {
      metadata.treePath = scriptObject.treePath;
    }

    // Add treePath array for group collections
    if (scriptObject.isGroup && scriptObject.treePath) {
      metadata.treePath = scriptObject.treePath;
      metadata.isGroup = true;
    }

    return metadata;
  }

  /**
   * Generates a simple UUID for client-side use
   */
  private generateUUID(): string {
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
    merged["lastModified"] = new Date().toISOString();

    return merged;
  }
}
