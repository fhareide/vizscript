// Type definition for VizScriptObject (shared with client)
export type VizScriptObject = {
  name: string;
  type: string;
  extension: string;
  code: string;
  scenePath: string;
  vizId: string;
  treePath?: string | string[]; // Stable tree path - string for individual scripts, array for groups
  children: string[];
  isGroup?: boolean; // Flag to identify if this is a grouped collection
};

export class MetadataProcessor {
  private metaContent: string[];
  private currentMetaJson: any;

  constructor() {
    this.metaContent = [];
    this.currentMetaJson = {};
  }

  public extractMetadata(lines: string[]): void {
    let isCollectingMeta = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      if (line.includes("VSCODE-META-START")) {
        isCollectingMeta = true;
        // Remove the keyword and keep only the portion after it
        let startIndex = line.indexOf("VSCODE-META-START") + "VSCODE-META-START".length;
        line = line.substring(startIndex).trim();
      }

      if (line.includes("VSCODE-META-END")) {
        // Remove the keyword and keep only the portion before it
        let endIndex = line.indexOf("VSCODE-META-END");
        line = line.substring(0, endIndex).trim();
        this.metaContent.push(line); // Add the final line before ending collection

        isCollectingMeta = false;
        this.parseMetaContent();
        this.metaContent = []; // Reset the meta content array
        continue;
      }

      if (isCollectingMeta) {
        // Add line to metaContent if between VSCODE-META-START and VSCODE-META-END
        this.metaContent.push(line);
        continue;
      }
    }
  }

  private parseMetaContent(): void {
    // Join the collected lines, remove all apostrophes, and parse as JSON
    let metaString = this.metaContent.join("\n").replace(/'/g, "");
    try {
      this.currentMetaJson = JSON.parse(metaString);
      console.log("Parsed meta content:", this.currentMetaJson);
    } catch (error) {
      this.currentMetaJson = {};
      console.error("Failed to parse meta content:", error);
    }
  }

  public getCurrentMetaJson(): any {
    return this.currentMetaJson;
  }

  public getMetaValue(key: string): any {
    return this.currentMetaJson[key];
  }

  public setMetaValue(key: string, value: any): void {
    this.currentMetaJson[key] = value;
  }

  public writeMetadataBack(lines: string[]): string[] {
    let newLines: string[] = [];
    let isMetaSection = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      if (line.includes("VSCODE-META-START")) {
        isMetaSection = true;
        newLines.push(line);
        newLines.push(this.stringifyMetaContent());
        continue;
      }

      if (line.includes("VSCODE-META-END")) {
        isMetaSection = false;
      }

      if (!isMetaSection) {
        newLines.push(line);
      }
    }

    return newLines;
  }

  private stringifyMetaContent(): string {
    return JSON.stringify(this.currentMetaJson, null, 2)
      .split("\n")
      .map((line) => `'${line}`)
      .join("\n");
  }

  // New methods for Phase 1 implementation

  /**
   * Detects if metadata block exists in the provided lines
   */
  public detectMetadataExistence(lines: string[]): boolean {
    let hasStart = false;
    let hasEnd = false;

    for (const line of lines) {
      if (line.includes("VSCODE-META-START")) {
        hasStart = true;
      }
      if (line.includes("VSCODE-META-END")) {
        hasEnd = true;
      }
      // Early exit if both found
      if (hasStart && hasEnd) {
        return true;
      }
    }

    return hasStart && hasEnd;
  }

  /**
   * Creates default metadata from script object properties
   */
  public createDefaultMetadata(scriptObject?: VizScriptObject): object {
    const now = new Date().toISOString();
    const uuid = this.generateUUID();

    const defaultMetadata: any = {
      scenePath: scriptObject?.scenePath || "",
      filePath: "", // Will be set when file is saved locally
      fileName: scriptObject?.name || "untitled",
      UUID: uuid,
      scriptType: scriptObject?.type || "Scene",
      vizId: scriptObject?.vizId || "",
      lastModified: now,
      version: "1.0.0",
      author: process.env.USERNAME || process.env.USER || "unknown",
      description: `Auto-generated metadata for ${scriptObject?.name || "script"}`,
    };

    // Only add treePath for container scripts
    if (scriptObject?.type === "Container" && scriptObject?.treePath) {
      defaultMetadata.treePath = scriptObject.treePath;
    }

    // Add treePath array for group collections
    if (scriptObject?.isGroup && scriptObject?.treePath) {
      defaultMetadata.treePath = scriptObject.treePath;
      defaultMetadata.isGroup = true;
    }

    return defaultMetadata;
  }

  /**
   * Validates metadata structure and required fields
   */
  public validateMetadata(metadata: object): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const requiredFields = ["scenePath", "UUID", "scriptType", "vizId"];

    if (!metadata || typeof metadata !== "object") {
      errors.push("Metadata must be a valid object");
      return { isValid: false, errors };
    }

    // Check required fields (filePath is optional since it gets set when saved)
    for (const field of requiredFields) {
      if (!metadata[field] || (typeof metadata[field] === "string" && metadata[field].trim() === "")) {
        errors.push(`Required field '${field}' is missing or empty`);
      }
    }

    // FilePath is optional but should be a string if present
    if (metadata["filePath"] && typeof metadata["filePath"] !== "string") {
      errors.push("filePath must be a string");
    }

    // Validate specific field formats
    if (metadata["scriptType"] && !["Scene", "Container", "Event"].includes(metadata["scriptType"])) {
      errors.push("scriptType must be one of: Scene, Container, Event");
    }

    if (metadata["UUID"] && typeof metadata["UUID"] !== "string") {
      errors.push("UUID must be a string");
    }

    if (metadata["lastModified"] && !this.isValidISO8601(metadata["lastModified"])) {
      errors.push("lastModified must be a valid ISO 8601 date string");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Merges existing metadata with updates
   */
  public mergeMetadata(existing: object, updates: object): object {
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

  /**
   * Generates properly formatted metadata block as string array
   */
  public generateMetadataBlock(metadata: object): string[] {
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
   * Updates metadata in existing lines, replacing the current metadata block
   */
  public updateMetadataInLines(lines: string[], newMetadata: object): string[] {
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
   * Injects metadata block at the beginning of lines if it doesn't exist
   */
  public injectMetadataIfMissing(
    lines: string[],
    scriptObject?: VizScriptObject,
  ): {
    lines: string[];
    wasInjected: boolean;
  } {
    if (this.detectMetadataExistence(lines)) {
      return { lines, wasInjected: false };
    }

    const defaultMetadata = this.createDefaultMetadata(scriptObject);
    const metadataBlock = this.generateMetadataBlock(defaultMetadata);

    return {
      lines: [...metadataBlock, "", ...lines],
      wasInjected: true,
    };
  }

  // Helper methods

  private generateUUID(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private isValidISO8601(dateString: string): boolean {
    try {
      const date = new Date(dateString);
      return date.toISOString() === dateString;
    } catch {
      return false;
    }
  }
}
