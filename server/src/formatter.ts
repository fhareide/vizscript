import { TextDocument } from "vscode-languageserver-textdocument";
import * as ls from "vscode-languageserver/node";
import * as fs from "fs";
import * as path from "path";

/**
 * Viz Script Document Formatter
 * Handles formatting for Viz Script files with proper indentation and structure
 */
export class VizScriptFormatter {
  private indentSize: number = 2;
  private useSpaces: boolean = true;
  private enabled: boolean = true;
  private keywordLowercase: boolean = true;
  private addLinesBetweenMethods: boolean = true;
  private builtInTypes: Set<string> = new Set();

  constructor() {
    this.loadBuiltInTypes();
  }

  /**
   * Load built-in types from completion JSON files
   */
  private loadBuiltInTypes(): void {
    const completionFiles = [
      "viz_completions.json",
      "viz_completions4.json",
      "viz_completions5.json",
      "vizevent_completions.json",
    ];

    // Add basic VizScript types
    const basicTypes = ["String", "Integer", "Double", "Boolean", "Object", "Variant"];
    basicTypes.forEach((type) => this.builtInTypes.add(type));

    for (const fileName of completionFiles) {
      try {
        const filePath = path.join(__dirname, fileName);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf8");
          const data = JSON.parse(content);
          this.extractTypesFromCompletionData(data);
        }
      } catch (error) {
        console.warn(`Failed to load types from ${fileName}:`, error);
      }
    }
  }

  /**
   * Extract types from completion data
   */
  private extractTypesFromCompletionData(data: any): void {
    // Extract from return_value fields
    const extractTypes = (obj: any) => {
      if (typeof obj === "object" && obj !== null) {
        if (obj.return_value && typeof obj.return_value === "string" && obj.return_value !== "") {
          // Clean up type names (remove array brackets, generics, etc.)
          let typeName = obj.return_value
            .replace(/\[.*?\]/g, "")
            .replace(/<.*?>/g, "")
            .trim();
          if (typeName && typeName !== "Type") {
            this.builtInTypes.add(typeName);
          }
        }

        // Extract from code_hint patterns like "As SomeType"
        if (obj.code_hint && typeof obj.code_hint === "string") {
          const asMatches = obj.code_hint.match(/\bAs\s+([A-Za-z][A-Za-z0-9]*)/gi);
          if (asMatches) {
            asMatches.forEach((match) => {
              const typeName = match.replace(/^As\s+/i, "").trim();
              if (typeName && typeName !== "Type") {
                this.builtInTypes.add(typeName);
              }
            });
          }
        }

        // Recursively search nested objects and arrays
        for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
            extractTypes(obj[key]);
          }
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((item) => extractTypes(item));
      }
    };

    extractTypes(data);
  }

  /**
   * Update formatter settings
   */
  public updateSettings(settings: {
    enabled: boolean;
    indentSize: number;
    useSpaces: boolean;
    keywordLowercase: boolean;
    addLinesBetweenMethods: boolean;
  }): void {
    this.enabled = settings.enabled;
    this.indentSize = settings.indentSize;
    this.useSpaces = settings.useSpaces;
    this.keywordLowercase = settings.keywordLowercase;
    this.addLinesBetweenMethods = settings.addLinesBetweenMethods;
  }

  /**
   * Format the entire document
   */
  public formatDocument(document: TextDocument): ls.TextEdit[] {
    if (!this.enabled) {
      return [];
    }

    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const formattedLines = this.formatLines(lines);

    // Return a single edit that replaces the entire document
    const fullRange = ls.Range.create(ls.Position.create(0, 0), ls.Position.create(lines.length, 0));

    return [ls.TextEdit.replace(fullRange, formattedLines.join("\n"))];
  }

  /**
   * Format a range of the document
   */
  public formatRange(document: TextDocument, range: ls.Range): ls.TextEdit[] {
    if (!this.enabled) {
      return [];
    }

    const text = document.getText();
    const lines = text.split(/\r?\n/);
    const startLine = range.start.line;
    const endLine = range.end.line;

    // Extract the range to format
    const rangeLines = lines.slice(startLine, endLine + 1);
    const formattedLines = this.formatLines(rangeLines, startLine, lines);

    // Replace the range with formatted content
    const rangeToReplace = ls.Range.create(ls.Position.create(startLine, 0), ls.Position.create(endLine + 1, 0));

    return [ls.TextEdit.replace(rangeToReplace, formattedLines.join("\n") + "\n")];
  }

  /**
   * Format lines with proper indentation and structure
   */
  private formatLines(lines: string[], startLineIndex: number = 0, allLines?: string[]): string[] {
    console.log("[DEBUG] Starting formatLines with", lines.length, "lines");
    const formattedLines: string[] = [];
    let indentLevel = 0;
    let inMetadata = false;
    let inMultiLineString = false;
    let previousTrimmedLine = "";

    // If formatting a range, calculate initial indent level
    if (startLineIndex > 0 && allLines) {
      indentLevel = this.calculateIndentLevel(allLines.slice(0, startLineIndex));
    } else if (startLineIndex === 0 && lines.length > 0) {
      // For full document formatting, detect the initial context from the first non-empty line
      indentLevel = this.detectInitialIndentLevel(lines);
    }

    console.log("[DEBUG] Initial indent level:", indentLevel);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      console.log(`[DEBUG] Line ${i}: "${trimmedLine}" (indent level: ${indentLevel})`);

      // Handle metadata sections - preserve original formatting
      if (this.isMetadataStart(trimmedLine)) {
        inMetadata = true;
        formattedLines.push(line);
        previousTrimmedLine = trimmedLine;
        continue;
      }

      if (this.isMetadataEnd(trimmedLine)) {
        inMetadata = false;
        formattedLines.push(line);
        previousTrimmedLine = trimmedLine;
        continue;
      }

      if (inMetadata) {
        formattedLines.push(line);
        previousTrimmedLine = trimmedLine;
        continue;
      }

      // Skip empty lines (but still track multi-line string state)
      if (trimmedLine === "") {
        formattedLines.push("");
        previousTrimmedLine = trimmedLine;
        continue;
      }

      // Check if we're currently in a multi-line string before processing this line
      const wasInMultiLineString = inMultiLineString;

      // Track multi-line string state for next iteration
      const quoteInfo = this.hasUnmatchedQuotes(line, inMultiLineString);
      if (quoteInfo.hasUnmatched) {
        inMultiLineString = quoteInfo.isOpening;
      }

      // Add blank line between consecutive methods if enabled
      if (
        this.addLinesBetweenMethods &&
        this.isMethodBeginning(trimmedLine) &&
        this.isMethodEnding(previousTrimmedLine) &&
        previousTrimmedLine !== ""
      ) {
        formattedLines.push("");
      }

      // Add blank line before sub/function if previous line is not empty and not a comment
      if (
        this.isMethodBeginning(trimmedLine) &&
        previousTrimmedLine !== "" &&
        !this.isComment(previousTrimmedLine) &&
        !this.isMethodEnding(previousTrimmedLine) // Don't double-add if already handled above
      ) {
        formattedLines.push("");
      }

      // Simple indentation logic - back to basics
      if (!this.isComment(trimmedLine) && !wasInMultiLineString) {
        // Handle closing statements first - reduce indent before formatting
        if (this.isClosingStatement(trimmedLine)) {
          console.log(`[DEBUG] Found closing statement: "${trimmedLine}"`);
          indentLevel = Math.max(0, indentLevel - 1);
          console.log(`[DEBUG] Indent level after closing: ${indentLevel}`);
        }
      }

      // Special handling for else/elseif/case statements - align with their parent
      let lineIndentLevel = indentLevel;
      if (!this.isComment(trimmedLine) && !wasInMultiLineString) {
        if (this.isElseStatement(trimmedLine) || this.isCaseStatement(trimmedLine)) {
          console.log(`[DEBUG] Found else/case statement: "${trimmedLine}"`);
          lineIndentLevel = Math.max(0, indentLevel - 1);
          console.log(`[DEBUG] Line indent level for else/case: ${lineIndentLevel}`);
        }
      }

      // Format the line with calculated indentation level
      const formattedLine = this.formatLine(trimmedLine, lineIndentLevel);
      console.log(`[DEBUG] Formatted line: "${formattedLine}"`);
      formattedLines.push(formattedLine);

      // Add blank line after method ending if next line is not empty
      if (this.isMethodEnding(trimmedLine)) {
        // Look ahead to the next non-empty line
        const nextLineIndex = i + 1;
        if (nextLineIndex < lines.length) {
          const nextLine = lines[nextLineIndex];
          const nextTrimmedLine = nextLine.trim();

          // Add blank line if next line exists and is not empty
          if (nextTrimmedLine !== "") {
            formattedLines.push("");
          }
        }
      }

      // Handle opening statements - increase indent after formatting
      if (!this.isComment(trimmedLine) && !wasInMultiLineString) {
        if (this.isOpeningStatement(trimmedLine)) {
          console.log(`[DEBUG] Found opening statement: "${trimmedLine}"`);
          indentLevel++;
          console.log(`[DEBUG] Indent level after opening: ${indentLevel}`);
        }
      }

      // Update previous line for next iteration (only update with non-empty trimmed lines)
      if (trimmedLine !== "") {
        previousTrimmedLine = trimmedLine;
      }
    }

    console.log("[DEBUG] Final formatted lines:", formattedLines);
    return formattedLines;
  }

  /**
   * Calculate the indent level for a given set of lines
   */
  private calculateIndentLevel(lines: string[]): number {
    let level = 0;
    let inMetadata = false;
    let inMultiLineString = false;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (this.isMetadataStart(trimmedLine)) {
        inMetadata = true;
        continue;
      }

      if (this.isMetadataEnd(trimmedLine)) {
        inMetadata = false;
        continue;
      }

      if (inMetadata || trimmedLine === "") {
        continue;
      }

      // Check if we're currently in a multi-line string before processing this line
      const wasInMultiLineString = inMultiLineString;

      // Track multi-line string state for next iteration
      const quoteInfo = this.hasUnmatchedQuotes(line, inMultiLineString);
      if (quoteInfo.hasUnmatched) {
        inMultiLineString = quoteInfo.isOpening;
      }

      // Only apply keyword detection if not in a multi-line string and not a comment
      if (!this.isComment(trimmedLine) && !wasInMultiLineString) {
        if (this.isOpeningStatement(trimmedLine)) {
          level++;
        }

        if (this.isClosingStatement(trimmedLine)) {
          level = Math.max(0, level - 1);
        }
      }
    }

    return level;
  }

  /**
   * Detect the initial indent level for document formatting based on the first non-empty line
   */
  private detectInitialIndentLevel(lines: string[]): number {
    // Find the first non-empty, non-comment, non-metadata line
    for (const line of lines) {
      const trimmedLine = line.trim();

      if (
        trimmedLine === "" ||
        this.isComment(trimmedLine) ||
        this.isMetadataStart(trimmedLine) ||
        this.isMetadataEnd(trimmedLine)
      ) {
        continue;
      }

      // Check if this line has existing indentation
      const leadingSpaces = line.match(/^ */)?.[0].length || 0;
      const leadingTabs = line.match(/^\t*/)?.[0].length || 0;

      // Calculate current indent level from existing indentation
      const currentIndentLevel = this.useSpaces ? Math.floor(leadingSpaces / this.indentSize) : leadingTabs;

      // If this is a root-level statement (sub, function, etc.), the document starts at the calculated level
      if (this.isMethodBeginning(trimmedLine)) {
        return currentIndentLevel;
      }

      // For other statements, we assume they're inside a block and adjust accordingly
      return Math.max(0, currentIndentLevel);
    }

    // Default to 0 if no code lines found
    return 0;
  }

  /**
   * Format a single line with proper indentation and spacing
   */
  private formatLine(line: string, indentLevel: number): string {
    const indent = this.getIndent(indentLevel);

    // Handle full comment lines
    if (this.isComment(line)) {
      return indent + line;
    }

    // Handle lines with end-of-line comments
    const commentIndex = line.indexOf("'");
    if (commentIndex > -1 && !line.includes("VSCODE-META-START") && !line.includes("VSCODE-META-END")) {
      const codePart = line.substring(0, commentIndex).trimEnd();
      const commentPart = line.substring(commentIndex);

      if (codePart === "") {
        // Line is just a comment
        return indent + line;
      }

      // Format only the code part and append the comment unchanged
      const formattedCode = this.formatCodeLine(codePart);
      return indent + formattedCode + " " + commentPart;
    }

    // Format the entire line (no comment)
    return indent + this.formatCodeLine(line);
  }

  /**
   * Format just the code part of a line (no comments)
   */
  private formatCodeLine(line: string): string {
    if (this.isVariableDeclaration(line)) {
      return this.formatVariableDeclaration(line);
    }

    if (this.isAssignment(line)) {
      return this.formatAssignment(line);
    }

    if (this.isIfStatement(line)) {
      return this.formatIfStatement(line);
    }

    if (this.isForStatement(line)) {
      return this.formatForStatement(line);
    }

    if (this.isWhileStatement(line)) {
      return this.formatWhileStatement(line);
    }

    if (this.isDoStatement(line)) {
      return this.formatDoStatement(line);
    }

    if (this.isLoopStatement(line)) {
      return this.formatLoopStatement(line);
    }

    if (this.isSelectCaseStatement(line)) {
      return this.formatSelectCaseStatement(line);
    }

    if (this.isCaseStatement(line)) {
      return this.formatCaseStatement(line);
    }

    if (this.isFunctionDeclaration(line)) {
      return this.formatFunctionDeclaration(line);
    }

    if (this.isSubDeclaration(line)) {
      return this.formatSubDeclaration(line);
    }

    // Default formatting - ensure proper spacing
    return this.formatGenericStatement(line);
  }

  /**
   * Generate indent string
   */
  private getIndent(level: number): string {
    if (this.useSpaces) {
      return " ".repeat(level * this.indentSize);
    } else {
      return "\t".repeat(level);
    }
  }

  /**
   * Format keyword case based on settings
   */
  private formatKeywordCase(text: string): string {
    if (this.keywordLowercase) {
      return text.toLowerCase();
    } else {
      // Pascal case when not lowercase
      return this.formatTypeToPascalCase(text);
    }
  }

  /**
   * Format types to Pascal case (always, regardless of settings)
   */
  private formatTypeToPascalCase(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  /**
   * Format statement keywords (like IF, DO, FUNCTION, etc.)
   */
  private formatStatementKeywords(text: string): string {
    const keywords = [
      // Compound keywords first (to prevent partial matches)
      "exit function",
      "exit sub",
      "exit do",
      "end function",
      "end sub",
      "end structure",
      "end if",
      "end select",
      "select case",
      "case else",
      // Single keywords after compound ones
      "if",
      "then",
      "else",
      "elseif",
      "for",
      "next",
      "to",
      "step",
      "while",
      "do",
      "loop",
      "until",
      "function",
      "sub",
      "structure",
      "case",
      "dim",
      "redim",
      "global",
      "local",
      "and",
      "or",
      "not",
      "as",
    ];

    let result = text;
    keywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword.replace(/\s+/g, "\\s+")}\\b`, "gi");
      result = result.replace(regex, this.formatKeywordCase(keyword));
    });

    return result;
  }

  /**
   * Format built-in types to Pascal case (always, regardless of settings)
   */
  private formatBuiltInTypes(text: string): string {
    let result = text;

    // Use the loaded types from JSON files
    this.builtInTypes.forEach((type) => {
      const regex = new RegExp(`\\b${type}\\b`, "gi");
      // Always format types as Pascal case, regardless of keyword settings
      const pascalType = this.formatTypeToPascalCase(type);
      result = result.replace(regex, pascalType);
    });

    return result;
  }

  /**
   * Check if line is a metadata start
   */
  private isMetadataStart(line: string): boolean {
    return line.includes("'VSCODE-META-START");
  }

  /**
   * Check if line is a metadata end
   */
  private isMetadataEnd(line: string): boolean {
    return line.includes("'VSCODE-META-END");
  }

  /**
   * Check if line is an opening statement
   */
  private isOpeningStatement(line: string): boolean {
    console.log(`[DEBUG] isOpeningStatement called with: "${line}"`);

    // Comments can never be opening statements
    if (this.isComment(line)) {
      console.log(`[DEBUG] isOpeningStatement: "${line}" -> false (comment)`);
      return false;
    }

    const lowerLine = line.toLowerCase().trim();
    console.log(`[DEBUG] isOpeningStatement lowerLine: "${lowerLine}"`);

    let isOpening = false;

    if (lowerLine.startsWith("sub ")) {
      isOpening = true;
      console.log(`[DEBUG] isOpeningStatement: sub detected`);
    } else if (lowerLine.startsWith("function ")) {
      isOpening = true;
      console.log(`[DEBUG] isOpeningStatement: function detected`);
    } else if (lowerLine.startsWith("structure ")) {
      isOpening = true;
      console.log(`[DEBUG] isOpeningStatement: structure detected`);
    } else if (this.isMultiLineIfStatement(lowerLine)) {
      isOpening = true;
      console.log(`[DEBUG] isOpeningStatement: multi-line if detected`);
    } else if (lowerLine.startsWith("for ")) {
      isOpening = true;
      console.log(`[DEBUG] isOpeningStatement: for detected`);
    } else if (lowerLine.startsWith("while ")) {
      isOpening = true;
      console.log(`[DEBUG] isOpeningStatement: while detected`);
    } else if (lowerLine.startsWith("do ") || lowerLine === "do") {
      isOpening = true;
      console.log(`[DEBUG] isOpeningStatement: do detected`);
    } else if (lowerLine.startsWith("select case ")) {
      isOpening = true;
      console.log(`[DEBUG] isOpeningStatement: select case detected`);
    }

    console.log(`[DEBUG] isOpeningStatement: "${line}" -> ${isOpening}`);
    return isOpening;
  }

  /**
   * Check if this is a multi-line if statement (needs end if)
   * Single-line if statements like "if condition then action" don't need end if
   */
  private isMultiLineIfStatement(lowerLine: string): boolean {
    if (!lowerLine.startsWith("if ")) {
      return false;
    }

    // Check if it's a single-line if statement
    // Single-line if: "if condition then action"
    // Multi-line if: "if condition then" (no action after then)

    // Look for "then" keyword (could be " then " or " then" at end of line)
    const thenRegex = /\bthen\b/;
    const thenMatch = lowerLine.match(thenRegex);
    if (!thenMatch) {
      return false; // No "then" found, not a valid if statement
    }

    const thenIndex = thenMatch.index!;
    const afterThen = lowerLine.substring(thenIndex + 4).trim();

    // If there's content after "then", it's a single-line if statement
    // If there's no content after "then", it's a multi-line if block
    const isMultiLine = afterThen === "";

    console.log(`[DEBUG] isMultiLineIfStatement: "${lowerLine}" -> ${isMultiLine} (afterThen: "${afterThen}")`);
    return isMultiLine;
  }

  /**
   * Check if line is a closing statement
   */
  private isClosingStatement(line: string): boolean {
    // Comments can never be closing statements
    if (this.isComment(line)) {
      return false;
    }

    const lowerLine = line.toLowerCase().trim();
    const isClosing =
      lowerLine.startsWith("end sub") ||
      lowerLine.startsWith("end function") ||
      lowerLine.startsWith("end structure") ||
      lowerLine.startsWith("end if") ||
      lowerLine.startsWith("end select") ||
      lowerLine.startsWith("next") ||
      /\bloop\b/.test(lowerLine); // Use word boundary to match "loop" as complete word, not part of "LoopPages"
    // Note: case statements are NOT closing statements - they align with select case

    if (isClosing) {
      console.log(`[DEBUG] isClosingStatement: "${line}" -> true`);
    }
    return isClosing;
  }

  /**
   * Check if line is a comment
   */
  private isComment(line: string): boolean {
    return line.trim().startsWith("'");
  }

  /**
   * Check if line has unmatched quotes (indicates start/end of multi-line string)
   */
  private hasUnmatchedQuotes(
    line: string,
    currentlyInMultiLineString: boolean,
  ): { hasUnmatched: boolean; isOpening: boolean } {
    let quoteCount = 0;
    let inQuote = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        // Handle C-style escaped quotes (\")
        if (i > 0 && line[i - 1] === "\\") {
          // This is an escaped quote, don't count it
          continue;
        }
        // Handle VBScript-style escaped quotes ("")
        if (i + 1 < line.length && line[i + 1] === '"') {
          i++; // Skip the escaped quote
          continue;
        }
        quoteCount++;
        inQuote = !inQuote;
      }
    }

    const hasUnmatched = quoteCount % 2 === 1;

    // If we have unmatched quotes, determine if opening or closing based on current state
    let isOpening = false;
    if (hasUnmatched) {
      // If we're currently in a multiline string, an unmatched quote closes it
      // If we're not in a multiline string, an unmatched quote opens it
      isOpening = !currentlyInMultiLineString;
    }

    return {
      hasUnmatched,
      isOpening,
    };
  }

  /**
   * Check if line is a variable declaration
   */
  private isVariableDeclaration(line: string): boolean {
    const lowerLine = line.toLowerCase();
    return (
      lowerLine.startsWith("dim ") ||
      lowerLine.startsWith("redim ") ||
      lowerLine.startsWith("global ") ||
      lowerLine.startsWith("local ")
    );
  }

  /**
   * Check if line is an assignment
   */
  private isAssignment(line: string): boolean {
    return (
      line.includes("=") && !line.includes("==") && !line.includes("<=") && !line.includes(">=") && !line.includes("<>")
    );
  }

  /**
   * Check if line is an if statement (for formatting purposes)
   */
  private isIfStatement(line: string): boolean {
    const lowerLine = line.toLowerCase();
    return lowerLine.startsWith("if ") || lowerLine.startsWith("elseif ");
  }

  /**
   * Check if line is a for statement
   */
  private isForStatement(line: string): boolean {
    return line.toLowerCase().startsWith("for ");
  }

  /**
   * Check if line is a while statement
   */
  private isWhileStatement(line: string): boolean {
    return line.toLowerCase().startsWith("while ");
  }

  /**
   * Check if line is a do statement
   */
  private isDoStatement(line: string): boolean {
    const lowerLine = line.toLowerCase();
    return lowerLine.startsWith("do ") || lowerLine.trim() === "do";
  }

  /**
   * Check if line is a loop statement
   */
  private isLoopStatement(line: string): boolean {
    const lowerLine = line.toLowerCase();
    return lowerLine.startsWith("loop") || lowerLine.trim() === "loop";
  }

  /**
   * Check if line is a select case statement
   */
  private isSelectCaseStatement(line: string): boolean {
    return line.toLowerCase().startsWith("select case ");
  }

  /**
   * Check if line is a case statement
   */
  private isCaseStatement(line: string): boolean {
    const lowerLine = line.toLowerCase();
    return lowerLine.startsWith("case ") || lowerLine === "case else";
  }

  /**
   * Check if line is a method/function ending
   */
  private isMethodEnding(line: string): boolean {
    const lowerLine = line.toLowerCase().trim();
    return lowerLine.startsWith("end sub") || lowerLine.startsWith("end function");
  }

  /**
   * Check if line is a method/function beginning
   */
  private isMethodBeginning(line: string): boolean {
    const lowerLine = line.toLowerCase().trim();
    return lowerLine.startsWith("sub ") || lowerLine.startsWith("function ");
  }

  /**
   * Check if line is an else statement
   */
  private isElseStatement(line: string): boolean {
    // Comments can never be else statements
    if (this.isComment(line)) {
      return false;
    }

    const lowerLine = line.toLowerCase().trim();
    const isElse = lowerLine === "else" || lowerLine.startsWith("else ") || lowerLine.startsWith("elseif ");

    if (isElse) {
      console.log(`[DEBUG] isElseStatement: "${line}" -> true`);
    }
    return isElse;
  }

  /**
   * Format variable declaration
   */
  private formatVariableDeclaration(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text.replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ");
      result = this.formatStatementKeywords(result);
      return this.formatBuiltInTypes(result);
    });
  }

  /**
   * Format assignment statement
   */
  private formatAssignment(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text.replace(/\s+/g, " ");

      // Apply operator spacing FIRST (before compound operators to avoid conflicts)
      result = this.formatOperatorSpacing(result);

      // Handle compound operators (+=, -=, *=, /=, &=) - this will fix any spacing issues
      result = result.replace(/\s*([+\-*\/&])\s*=\s*/g, " $1= ");

      // Handle regular assignment (= not preceded by +, -, *, /, or &)
      result = result.replace(/(?<![+\-*\/&])\s*=\s*/g, " = ");

      // Handle string concatenation operators (& not followed by =)
      result = result.replace(/\s*&\s*(?!=)/g, " & ");

      result = this.formatStatementKeywords(result);
      return this.formatBuiltInTypes(result);
    });
  }

  /**
   * Format if statement
   */
  private formatIfStatement(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text.replace(/\s+/g, " ").replace(/\s*\bthen\b\s*/gi, ` ${this.formatKeywordCase("then")} `);

      // Add operator spacing
      result = this.formatOperatorSpacing(result);

      // Format the main statement keywords
      result = result.replace(/\b(if|else|elseif|end\s+if)\b/gi, (match) => this.formatKeywordCase(match));
      return this.formatBuiltInTypes(result).trim();
    });
  }

  /**
   * Format for statement
   */
  private formatForStatement(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text
        .replace(/\s+/g, " ")
        .replace(/\s*=\s*/g, " = ")
        .replace(/\s*\bto\b\s*/gi, ` ${this.formatKeywordCase("to")} `)
        .replace(/\s*\bstep\b\s*/gi, ` ${this.formatKeywordCase("step")} `);

      // Format the main statement keywords
      result = result.replace(/\b(for|next)\b/gi, (match) => this.formatKeywordCase(match));
      return this.formatBuiltInTypes(result);
    });
  }

  /**
   * Format while statement
   */
  private formatWhileStatement(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text.replace(/\s+/g, " ");

      // Add operator spacing
      result = this.formatOperatorSpacing(result);

      // Format the main statement keywords
      result = result.replace(/\b(while)\b/gi, (match) => this.formatKeywordCase(match));
      return this.formatBuiltInTypes(result);
    });
  }

  /**
   * Format do statement
   */
  private formatDoStatement(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text
        .replace(/\s+/g, " ")
        .replace(/\s*\bwhile\b\s*/gi, ` ${this.formatKeywordCase("while")} `)
        .replace(/\s*\buntil\b\s*/gi, ` ${this.formatKeywordCase("until")} `);

      // Add operator spacing
      result = this.formatOperatorSpacing(result);

      // Format the main statement keywords
      result = result.replace(/\b(do)\b/gi, (match) => this.formatKeywordCase(match));
      return this.formatBuiltInTypes(result);
    });
  }

  /**
   * Format loop statement
   */
  private formatLoopStatement(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text
        .replace(/\s+/g, " ")
        .replace(/\s*\bwhile\b\s*/gi, ` ${this.formatKeywordCase("while")} `)
        .replace(/\s*\buntil\b\s*/gi, ` ${this.formatKeywordCase("until")} `)
        .replace(/\s*\band\b\s*/gi, ` ${this.formatKeywordCase("and")} `)
        .replace(/\s*\bor\b\s*/gi, ` ${this.formatKeywordCase("or")} `)
        .replace(/\s*\bnot\b\s*/gi, ` ${this.formatKeywordCase("not")} `);

      // Format the main statement keywords
      result = result.replace(/\b(loop)\b/gi, (match) => this.formatKeywordCase(match));
      return this.formatBuiltInTypes(result);
    });
  }

  /**
   * Format select case statement
   */
  private formatSelectCaseStatement(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text
        .replace(/\s+/g, " ")
        .replace(/\s*\band\b\s*/gi, ` ${this.formatKeywordCase("and")} `)
        .replace(/\s*\bor\b\s*/gi, ` ${this.formatKeywordCase("or")} `)
        .replace(/\s*\bnot\b\s*/gi, ` ${this.formatKeywordCase("not")} `);

      // Format the main statement keywords
      result = result.replace(/\b(select\s+case|end\s+select)\b/gi, (match) => this.formatKeywordCase(match));
      return this.formatBuiltInTypes(result);
    });
  }

  /**
   * Format case statement
   */
  private formatCaseStatement(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text
        .replace(/\s+/g, " ")
        .replace(/\s*,\s*/g, ", ")
        .replace(/\s*\bto\b\s*/gi, ` ${this.formatKeywordCase("to")} `)
        .replace(/\s*\band\b\s*/gi, ` ${this.formatKeywordCase("and")} `)
        .replace(/\s*\bor\b\s*/gi, ` ${this.formatKeywordCase("or")} `)
        .replace(/\s*\bnot\b\s*/gi, ` ${this.formatKeywordCase("not")} `);

      // Format the main statement keywords
      result = result.replace(/\b(case\s+else|case)\b/gi, (match) => this.formatKeywordCase(match));
      return this.formatBuiltInTypes(result);
    });
  }

  /**
   * Add proper spacing around operators - simplified approach
   */
  private formatOperatorSpacing(text: string): string {
    let result = text;

    // First, normalize multiple spaces to single spaces
    result = result.replace(/\s+/g, " ");

    // Handle compound operators FIRST and protect them completely
    result = result.replace(/<=>/g, "PLACEHOLDER_LTE_GTE");
    result = result.replace(/<>/g, "PLACEHOLDER_NOT_EQUAL");
    result = result.replace(/<=/g, "PLACEHOLDER_LTE");
    result = result.replace(/>=/g, "PLACEHOLDER_GTE");
    result = result.replace(/==/g, "PLACEHOLDER_EQUAL_EQUAL");
    result = result.replace(/\+=/g, "PLACEHOLDER_PLUS_EQUAL");
    result = result.replace(/-=/g, "PLACEHOLDER_MINUS_EQUAL");
    result = result.replace(/\*=/g, "PLACEHOLDER_MULT_EQUAL");
    result = result.replace(/\/=/g, "PLACEHOLDER_DIV_EQUAL");
    result = result.replace(/&=/g, "PLACEHOLDER_CONCAT_EQUAL");

    // Handle simple operators (but they won't affect the placeholders)
    result = result.replace(/\s*=\s*/g, " = ");
    result = result.replace(/\s*\+\s*/g, " + ");
    result = result.replace(/\s*-\s*/g, " - ");
    result = result.replace(/\s*\*\s*/g, " * ");
    result = result.replace(/\s*\/\s*/g, " / ");
    result = result.replace(/\s*\^\s*/g, " ^ ");
    result = result.replace(/\s*<\s*/g, " < ");
    result = result.replace(/\s*>\s*/g, " > ");

    // Restore compound operators with proper spacing
    result = result.replace(/PLACEHOLDER_LTE_GTE/g, " <=> ");
    result = result.replace(/PLACEHOLDER_NOT_EQUAL/g, " <> ");
    result = result.replace(/PLACEHOLDER_LTE/g, " <= ");
    result = result.replace(/PLACEHOLDER_GTE/g, " >= ");
    result = result.replace(/PLACEHOLDER_EQUAL_EQUAL/g, " == ");
    result = result.replace(/PLACEHOLDER_PLUS_EQUAL/g, " += ");
    result = result.replace(/PLACEHOLDER_MINUS_EQUAL/g, " -= ");
    result = result.replace(/PLACEHOLDER_MULT_EQUAL/g, " *= ");
    result = result.replace(/PLACEHOLDER_DIV_EQUAL/g, " /= ");
    result = result.replace(/PLACEHOLDER_CONCAT_EQUAL/g, " &= ");

    // Logical operators
    result = result.replace(/\s*\bmod\b\s*/gi, ` ${this.formatKeywordCase("mod")} `);
    result = result.replace(/\s*\band\b\s*/gi, ` ${this.formatKeywordCase("and")} `);
    result = result.replace(/\s*\bor\b\s*/gi, ` ${this.formatKeywordCase("or")} `);
    result = result.replace(/\s*\bnot\b\s*/gi, ` ${this.formatKeywordCase("not")} `);

    // Clean up any extra spaces
    result = result.replace(/\s+/g, " ");

    return result;
  }

  /**
   * Format generic statement
   */
  private formatGenericStatement(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text
        .replace(/\s+/g, " ")
        .replace(/\s*\(\s*/g, "(")
        .replace(/\s*\)\s*(?![&+\-*/=])/g, ")") // Don't remove space before operators
        .replace(/\s*,\s*/g, ", ")
        .replace(/\s*\.\s*/g, ".");

      // Add operator spacing
      result = this.formatOperatorSpacing(result);

      // Format remaining statement keywords that might not be caught by specific methods
      return this.formatStatementKeywords(result);
    });
  }

  /**
   * Format text while protecting string literals from modification
   */
  private formatWithStringProtection(line: string, formatFunction: (text: string) => string): string {
    const strings: string[] = [];
    let index = 0;

    console.log(`[DEBUG] formatWithStringProtection input: "${line}"`);

    // Replace all strings with placeholders
    // Handle both VBScript-style ("") and C-style (\") escaped quotes
    let textWithPlaceholders = line
      .replace(/"([^"\\]|\\.)*"/g, (match) => {
        const placeholder = `__STRING_${index}__`;
        strings[index] = match;
        console.log(`[DEBUG] Extracted string ${index}: "${match}" -> "${placeholder}"`);
        index++;
        return placeholder;
      })
      .replace(/'([^'\\]|\\.)*'/g, (match) => {
        const placeholder = `__STRING_${index}__`;
        strings[index] = match;
        console.log(`[DEBUG] Extracted string ${index}: "${match}" -> "${placeholder}"`);
        index++;
        return placeholder;
      });

    console.log(`[DEBUG] Text with placeholders: "${textWithPlaceholders}"`);

    // Apply formatting to text without strings
    let formatted = formatFunction(textWithPlaceholders);
    console.log(`[DEBUG] After formatting: "${formatted}"`);

    // Restore original strings
    for (let i = 0; i < strings.length; i++) {
      formatted = formatted.replace(`__STRING_${i}__`, strings[i]);
      console.log(`[DEBUG] Restored string ${i}: "${strings[i]}"`);
    }

    console.log(`[DEBUG] Final result: "${formatted}"`);
    return formatted;
  }

  /**
   * Check if line is a function declaration
   */
  private isFunctionDeclaration(line: string): boolean {
    return line.toLowerCase().startsWith("function ");
  }

  /**
   * Check if line is a sub declaration
   */
  private isSubDeclaration(line: string): boolean {
    return line.toLowerCase().startsWith("sub ");
  }

  /**
   * Format function declaration - preserve space before 'as'
   */
  private formatFunctionDeclaration(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text
        .replace(/\s+/g, " ")
        .replace(/\s*\(\s*/g, "(")
        .replace(/\s*\)\s*/g, ")")
        .replace(/\s*,\s*/g, ", ")
        .replace(/\s*\.\s*/g, ".")
        .replace(/\s+\bas\b\s+/gi, ` ${this.formatKeywordCase("as")} `) // Preserve space before 'as' with word boundaries
        .replace(/\)\s*\bas\b\s+/gi, `) ${this.formatKeywordCase("as")} `); // Handle case like ") as String" with word boundaries

      // Format the main statement keywords
      result = result.replace(/\b(function|end\s+function)\b/gi, (match) => this.formatKeywordCase(match));
      return this.formatBuiltInTypes(result);
    });
  }

  /**
   * Format sub declaration - preserve space before 'as'
   */
  private formatSubDeclaration(line: string): string {
    return this.formatWithStringProtection(line, (text) => {
      let result = text
        .replace(/\s+/g, " ")
        .replace(/\s*\(\s*/g, "(")
        .replace(/\s*\)\s*/g, ")")
        .replace(/\s*,\s*/g, ", ")
        .replace(/\s*\.\s*/g, ".")
        .replace(/\s+\bas\b\s+/gi, ` ${this.formatKeywordCase("as")} `) // Preserve space before 'as' with word boundaries
        .replace(/\)\s*\bas\b\s+/gi, `) ${this.formatKeywordCase("as")} `); // Handle case like ") as String" with word boundaries

      // Format the main statement keywords
      result = result.replace(/\b(sub|end\s+sub)\b/gi, (match) => this.formatKeywordCase(match));
      return this.formatBuiltInTypes(result);
    });
  }
}
