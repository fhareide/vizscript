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
}
