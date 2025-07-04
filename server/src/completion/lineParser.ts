import * as ls from "vscode-languageserver/node";
import { ParseResult, CompletionType } from "./types";

/**
 * Clean, modular line parsing to replace the complex 170-line getLineAt function
 */
export class LineParser {
  private static readonly OPERATORS = /[\=\>\<\+\-\*\/\&]/;
  private static readonly BRACKET_PAIRS = { "(": ")", "[": "]", "{": "}" };
  private static readonly MEMBER_SEPARATOR = /[\.]?([^\.\ ]+)[\.]+/gi;

  /**
   * Parse a line and return structured result
   */
  public parse(line: string, position: number, isSignatureHelp: boolean = false): ParseResult {
    try {
      // Step 1: Preprocess the line (remove comments, strings)
      const preprocessed = this.preprocessLine(line);

      // Step 2: Remove content within closed brackets
      const withoutBrackets = this.removeBracketContent(preprocessed);

      // Step 3: Handle open brackets
      const bracketProcessed = this.handleOpenBrackets(withoutBrackets, isSignatureHelp);

      // Step 4: Split by operators
      const operatorSplit = this.splitByOperators(bracketProcessed, isSignatureHelp);

      // Step 5: Extract member chain
      const memberChain = this.extractMemberChain(operatorSplit, isSignatureHelp);

      // Step 6: Determine completion context
      const context = this.determineContext(line, memberChain);

      return {
        cleanLine: operatorSplit,
        memberChain,
        context,
        hasOpenBracket: this.hasOpenBracket(line),
        bracketContent: this.getBracketContent(line),
      };
    } catch (error) {
      console.error("Error parsing line:", error);
      return {
        cleanLine: line,
        memberChain: [],
        context: CompletionType.ROOT_LEVEL,
        hasOpenBracket: false,
        bracketContent: "",
      };
    }
  }

  /**
   * Preprocess line by removing comments and string literals
   */
  private preprocessLine(line: string): string {
    if (!line) return "";

    let processed = line.trim();

    // Remove comments (but not within meta content)
    const commentIndex = processed.indexOf("'");
    if (commentIndex > -1 && !processed.includes("VSCODE-META-START") && !processed.includes("VSCODE-META-END")) {
      processed = processed.substring(0, commentIndex);
    }

    // Remove literal strings to prevent interference
    const stringLiterals = /\"(([^\"]|\"\")*)\"/gi;
    processed = processed.replace(stringLiterals, this.replaceBySpaces);

    return processed;
  }

  /**
   * Remove content within closed brackets
   */
  private removeBracketContent(line: string): string {
    const bracketRanges = this.getBracketRanges(line);
    let result = line;

    // Process ranges from right to left to maintain indices
    for (let i = bracketRanges.length - 1; i >= 0; i--) {
      const range = bracketRanges[i];
      const leftPart = result.slice(0, range.start.character + 1);
      const rightPart = result.slice(range.end.character);
      result = leftPart + rightPart;
    }

    return result;
  }

  /**
   * Handle open brackets for signature help and completion
   */
  private handleOpenBrackets(line: string, isSignatureHelp: boolean): string {
    const openBracketPos = this.getOpenBracketPosition(line);

    if (openBracketPos > 0) {
      if (!isSignatureHelp) {
        return line.slice(openBracketPos + 1);
      } else {
        const beforeBracket = line.slice(0, openBracketPos);
        const afterBracket = line.slice(openBracketPos + 1);
        const cleanBefore = this.removeBeforeOpenBracket(beforeBracket);
        return cleanBefore + "(" + afterBracket;
      }
    }

    return line;
  }

  /**
   * Split line by operators
   */
  private splitByOperators(line: string, isSignatureHelp: boolean): string {
    let result = line;

    // Split on "=" or ">"
    const assignmentMatch = result.match(/[\=\>]((.*)+)$/);
    if (assignmentMatch && assignmentMatch[1]) {
      result = assignmentMatch[1];
    }

    // Split on "<"
    const comparisonMatch = result.match(/[\<]((.*)+)$/);
    if (comparisonMatch && comparisonMatch[1]) {
      result = comparisonMatch[1];
    }

    // Split on "&" (but not for signature help)
    if (!isSignatureHelp) {
      const ampersandMatch = result.match(/\&(?=[^\&]*$)(.*)/);
      if (ampersandMatch && ampersandMatch[1]) {
        result = ampersandMatch[1];
      }
    }

    // Split on arithmetic operators
    const arithmeticMatch = result.match(/.+[\+\-\*\/](.+)$/);
    if (arithmeticMatch && arithmeticMatch[1]) {
      result = arithmeticMatch[1];
    }

    return result.trim();
  }

  /**
   * Extract member access chain from the line
   */
  private extractMemberChain(line: string, isSignatureHelp: boolean = false): string[] {
    const memberChain: string[] = [];
    let match;

    console.log("  -- Extracting member chain from line:", JSON.stringify(line));
    console.log("  -- Is signature help:", isSignatureHelp);

    // For signature help, find the outermost unclosed function call
    if (isSignatureHelp) {
      const activeFunctionCall = this.findActiveFunctionCall(line);
      if (activeFunctionCall) {
        console.log("  -- Found active function call:", activeFunctionCall);
        memberChain.push(activeFunctionCall);
      }
    } else {
      // For completion, use the original member separator regex
      console.log("  -- Using member separator regex:", LineParser.MEMBER_SEPARATOR.source);

      while ((match = LineParser.MEMBER_SEPARATOR.exec(line)) !== null) {
        console.log("  -- Found match:", match);
        if (match[1]) {
          let member = match[1];

          // Handle array notation
          const arrayMatch = member.match(/(.*)?[\[](.*?)[\]]$/);
          if (arrayMatch && arrayMatch[1]) {
            const baseName = arrayMatch[1];
            const indexContent = arrayMatch[2];

            // Check if it's an indexed access (e.g., [0], [1], [i]) vs generic array access (e.g., [])
            const isIndexedAccess = indexContent && indexContent.trim() !== "";

            if (isIndexedAccess) {
              // Preserve indexed access information
              member = baseName + "[" + indexContent + "]";
              console.log("  -- Indexed array access detected:", member);
            } else {
              // Generic array access
              member = baseName + "[]";
              console.log("  -- Generic array notation detected:", member);
            }
          }

          // Handle function calls
          const functionMatch = member.match(/(.*)?[\(].*?[\)]$/);
          if (functionMatch && functionMatch[1]) {
            member = functionMatch[1];
            console.log("  -- Function call detected:", member);
          }

          console.log("  -- Adding member to chain:", member);
          memberChain.push(member);
        }
      }

      // Reset regex for next use
      LineParser.MEMBER_SEPARATOR.lastIndex = 0;
    }

    console.log("  -- Final member chain:", memberChain);
    return memberChain;
  }

  /**
   * Determine completion context based on line content
   */
  private determineContext(line: string, memberChain: string[]): CompletionType {
    // Variable declaration
    if (/^[ \t]*dim[ \t]+([a-zA-Z0-9\-\_\,]+)[ \t]*([as]+)?$/.test(line)) {
      return CompletionType.VARIABLE_DECLARATION;
    }

    // Function/Structure declaration
    if (/^[ \t]*(function|structure)+[ \t]+([a-zA-Z0-9\-\_\,]+)$/.test(line)) {
      return CompletionType.FUNCTION_DECLARATION;
    }

    // Event declaration
    if (/^[ \t]*sub[ \t]+On?$/.test(line)) {
      return CompletionType.EVENT_DECLARATION;
    }

    // Assignment
    if (/\=[\s]*([^\=\.\)]+)$/.test(line)) {
      return CompletionType.ASSIGNMENT;
    }

    // Type annotation
    if (/[ \t]*as[ \t]+\S*$/.test(line)) {
      return CompletionType.TYPE_ANNOTATION;
    }

    // Member access - only if we found member access patterns (with trailing dots)
    if (memberChain.length > 0) {
      return CompletionType.MEMBER_ACCESS;
    }

    return CompletionType.ROOT_LEVEL;
  }

  /**
   * Get bracket ranges for removing closed bracket content
   */
  private getBracketRanges(line: string): ls.Range[] {
    const ranges: ls.Range[] = [];
    const stack: { char: string; pos: number }[] = [];

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === "(" || char === "[" || char === "{") {
        stack.push({ char, pos: i });
      } else if (char === ")" || char === "]" || char === "}") {
        const last = stack.pop();
        if (last && LineParser.BRACKET_PAIRS[last.char] === char) {
          ranges.push(ls.Range.create(ls.Position.create(0, last.pos), ls.Position.create(0, i)));
        }
      }
    }

    return ranges;
  }

  /**
   * Get position of the last unclosed bracket
   */
  private getOpenBracketPosition(line: string): number {
    const stack: number[] = [];

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === "(" || char === "[" || char === "{") {
        stack.push(i);
      } else if (char === ")" || char === "]" || char === "}") {
        stack.pop();
      }
    }

    return stack.length > 0 ? stack[stack.length - 1] : -1;
  }

  /**
   * Remove content before the last open bracket
   */
  private removeBeforeOpenBracket(line: string): string {
    const pos = this.getOpenBracketPosition(line);
    return pos > 0 ? line.slice(pos + 1) : line;
  }

  /**
   * Check if line has unclosed brackets
   */
  private hasOpenBracket(line: string): boolean {
    return this.getOpenBracketPosition(line) > -1;
  }

  /**
   * Get content within brackets
   */
  private getBracketContent(line: string): string {
    const pos = this.getOpenBracketPosition(line);
    return pos > -1 ? line.slice(pos + 1) : "";
  }

  /**
   * Replace text with spaces to maintain character positions
   */
  private replaceBySpaces(match: string): string {
    return " ".repeat(match.length);
  }

  /**
   * Find the active function call for signature help by tracking bracket depth
   */
  private findActiveFunctionCall(line: string): string | null {
    const functionCalls: { name: string; depth: number }[] = [];
    let depth = 0;
    let inString = false;
    let i = 0;

    console.log("  -- Analyzing line for active function call:", JSON.stringify(line));

    while (i < line.length) {
      const char = line[i];

      // Handle string literals
      if (char === '"') {
        inString = !inString;
      } else if (!inString) {
        // Look for function calls (pattern ending with opening parenthesis)
        if (char === "(") {
          // Find the function name before this opening parenthesis
          let functionName = "";
          let j = i - 1;

          // Skip any whitespace before the parenthesis
          while (j >= 0 && /\s/.test(line[j])) {
            j--;
          }

          // Extract the function name (alphanumeric characters, dots, underscores)
          while (j >= 0 && /[a-zA-Z0-9\._]/.test(line[j])) {
            functionName = line[j] + functionName;
            j--;
          }

          if (functionName) {
            // Clean up the function name (remove any leading dots)
            functionName = functionName.replace(/^\./, "");
            functionCalls.push({ name: functionName, depth });
            console.log("  -- Found function call:", functionName, "at depth:", depth);
          }

          depth++;
        } else if (char === ")") {
          depth--;
        }
      }

      i++;
    }

    // Find the outermost function call that's still open (has unmatched opening parenthesis)
    for (const call of functionCalls) {
      if (call.depth === 0) {
        console.log("  -- Active function call:", call.name);
        return call.name;
      }
    }

    console.log("  -- No active function call found");
    return null;
  }
}
