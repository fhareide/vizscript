import * as ls from "vscode-languageserver/node";
import { CompletionContext, CompletionType, VizScriptSettings, ResolutionMode } from "./types";
import { CompletionConfig } from "./config";
import { SymbolSelector } from "./symbolSelector";
import { LineParser } from "./lineParser";
import { SymbolResolver } from "./symbolResolver";
import { CompletionStrategyFactory } from "./strategies/factory";

/**
 * New modular completion service
 * This replaces the old monolithic completion handler
 */
export class CompletionService {
  private config: CompletionConfig;
  private symbolSelector: SymbolSelector;
  private lineParser: LineParser;
  private symbolResolver: SymbolResolver;
  private strategyFactory: CompletionStrategyFactory;

  constructor(
    symbolCache: { [id: string]: any[] },
    settings?: VizScriptSettings,
    documentUri?: string,
    scriptType?: string,
  ) {
    this.config = new CompletionConfig(settings);
    this.symbolSelector = new SymbolSelector(this.config, symbolCache);
    this.lineParser = new LineParser();
    this.symbolResolver = new SymbolResolver(symbolCache, documentUri || "", scriptType || "");
    this.strategyFactory = new CompletionStrategyFactory(this.symbolSelector, this.symbolResolver);
  }

  /**
   * Update settings for all components
   */
  public updateSettings(settings: VizScriptSettings): void {
    this.config.updateSettings(settings);
  }

  /**
   * Main completion handler - replaces the old monolithic handler
   */
  public getCompletions(
    line: string,
    position: ls.Position,
    character: number,
    documentUri: string,
    languageId: string,
  ): ls.CompletionItem[] {
    try {
      console.log("=== NEW COMPLETION SERVICE DEBUG ===");
      console.log("Line:", JSON.stringify(line));
      console.log("Position:", JSON.stringify(position));
      console.log("Character:", character);

      // Check if auto-complete is enabled
      if (!this.config.isAutoCompleteEnabled()) {
        console.log("Auto-complete is disabled");
        return [];
      }

      // Parse the line to get context
      const parseResult = this.lineParser.parse(line, character);
      console.log("Parse result:", JSON.stringify(parseResult, null, 2));

      // Create completion context
      const context: CompletionContext = {
        type: parseResult.context,
        line,
        position,
        memberChain: parseResult.memberChain,
        isSignatureHelp: false,
        document: {
          uri: documentUri,
          languageId,
        },
      };

      console.log("Context type:", context.type);
      console.log("Member chain:", context.memberChain);

      // Get appropriate strategy and completions
      const strategy = this.strategyFactory.createStrategy(context);
      console.log("Selected strategy:", strategy.constructor.name);

      const completions = strategy.getCompletions(context);

      console.log(`Completion: ${completions.length} items found using ${strategy.constructor.name}`);
      console.log("=== END NEW COMPLETION SERVICE DEBUG ===");
      return completions;
    } catch (error) {
      console.error("Error in CompletionService.getCompletions:", error);
      console.log("=== END NEW COMPLETION SERVICE DEBUG (ERROR) ===");
      return [];
    }
  }

  /**
   * Signature help handler - replaces the old signature help logic
   */
  public getSignatureHelp(
    line: string,
    position: ls.Position,
    character: number,
    documentUri: string,
    activeSignature: number = 0,
  ): ls.SignatureHelp | null {
    try {
      // Check if signature help is enabled
      if (!this.config.isSignatureHelpEnabled()) {
        return null;
      }

      // Parse the line for signature help
      const parseResult = this.lineParser.parse(line, character, true);

      if (parseResult.memberChain.length === 0) {
        return null;
      }

      // Resolve the symbol chain for signature help
      const result = this.symbolResolver.resolveSymbolChain(
        parseResult.memberChain,
        position,
        ResolutionMode.SIGNATURE,
      );

      if (!result.isResolved || !result.symbol) {
        return null;
      }

      // Count commas to determine active parameter (only top-level commas)
      const commaCount = this.countTopLevelCommas(parseResult.bracketContent);

      // Create signature help result
      const signatureHelp: ls.SignatureHelp = {
        signatures: [],
        activeSignature,
        activeParameter: commaCount,
      };

      // Build all signatures first
      const allSignatures: ls.SignatureInformation[] = [];
      if (result.symbol.signatureInfo) {
        allSignatures.push(result.symbol.signatureInfo);
      }
      if (result.symbol.overloads) {
        allSignatures.push(...result.symbol.overloads);
      }

      // Filter signatures based on parameter count - only show signatures that have enough parameters
      const validSignatures: ls.SignatureInformation[] = [];
      const validIndices: number[] = [];

      for (let i = 0; i < allSignatures.length; i++) {
        const signature = allSignatures[i];
        if (this.hasEnoughParameters(signature, commaCount)) {
          validSignatures.push(signature);
          validIndices.push(i);
        }
      }

      console.log(
        `Filtered ${validSignatures.length} valid signatures from ${allSignatures.length} total signatures for parameter position ${commaCount}`,
      );

      signatureHelp.signatures = validSignatures;

      // Adjust activeSignature to ensure it points to a valid signature
      if (validSignatures.length > 0) {
        // Find the new index of the previously active signature
        const originalActiveIndex = Math.min(activeSignature, allSignatures.length - 1);
        const newActiveIndex = validIndices.indexOf(originalActiveIndex);

        if (newActiveIndex >= 0) {
          // The previously active signature is still valid
          signatureHelp.activeSignature = newActiveIndex;
          console.log(`Mapped activeSignature from ${activeSignature} to ${newActiveIndex}`);
        } else {
          // The previously active signature was filtered out, default to first
          signatureHelp.activeSignature = 0;
          console.log(`Previous activeSignature ${activeSignature} filtered out, defaulting to 0`);
        }
      }

      return signatureHelp.signatures.length > 0 ? signatureHelp : null;
    } catch (error) {
      console.error("Error in CompletionService.getSignatureHelp:", error);
      return null;
    }
  }

  /**
   * Definition handler - replaces the old definition logic
   */
  public getDefinition(
    line: string,
    position: ls.Position,
    character: number,
    documentUri: string,
    word: string,
  ): ls.DefinitionLink[] {
    try {
      // Check if definition is enabled
      if (!this.config.isDefinitionEnabled()) {
        return [];
      }

      // Parse the line for definition
      const parseResult = this.lineParser.parse(line, character);

      let symbolChain: string[] = [];

      if (parseResult.memberChain.length > 0) {
        symbolChain = parseResult.memberChain;
      } else {
        symbolChain = [word];
      }

      // Resolve the symbol chain for definition
      const result = this.symbolResolver.resolveSymbolChain(symbolChain, position, ResolutionMode.DEFINITION);

      if (!result.isResolved || !result.symbol) {
        return [];
      }

      // Check if we're clicking on the definition itself
      if (result.symbol.nameLocation && this.isPositionInRange(result.symbol.nameLocation.range, position)) {
        return [];
      }

      // Create definition link
      const definitionLink: ls.DefinitionLink = {
        targetRange: result.symbol.symbolRange,
        targetUri: documentUri,
        targetSelectionRange: result.symbol.nameLocation?.range,
      };

      return [definitionLink];
    } catch (error) {
      console.error("Error in CompletionService.getDefinition:", error);
      return [];
    }
  }

  private isPositionInRange(range: ls.Range, position: ls.Position): boolean {
    if (range.start.line > position.line) return false;
    if (range.end.line < position.line) return false;
    if (range.start.line === position.line && range.start.character >= position.character) return false;
    if (range.end.line === position.line && range.end.character <= position.character) return false;
    return true;
  }

  /**
   * Check if a signature has enough parameters for the current position
   */
  private hasEnoughParameters(signature: ls.SignatureInformation, commaCount: number): boolean {
    if (!signature.parameters) {
      // No parameters defined - only valid if we're not expecting any parameters
      return commaCount === 0;
    }

    // We need at least commaCount + 1 parameters
    // (commaCount represents the number of commas, so parameter index)
    const requiredParams = commaCount + 1;
    const availableParams = signature.parameters.length;

    console.log(`Checking signature "${signature.label}": has ${availableParams} parameters, needs ${requiredParams}`);

    return availableParams >= requiredParams;
  }

  /**
   * Count only top-level commas, ignoring commas inside nested function calls and string literals
   */
  private countTopLevelCommas(bracketContent: string): number {
    if (!bracketContent) return 0;

    let commaCount = 0;
    let depth = 0;
    let inString = false;
    let i = 0;

    while (i < bracketContent.length) {
      const char = bracketContent[i];

      // Handle string literals
      if (char === '"') {
        inString = !inString;
      } else if (!inString) {
        // Handle brackets - increase depth
        if (char === "(" || char === "[" || char === "{") {
          depth++;
        }
        // Handle brackets - decrease depth
        else if (char === ")" || char === "]" || char === "}") {
          depth--;
        }
        // Count commas only at top level (depth 0)
        else if (char === "," && depth === 0) {
          commaCount++;
        }
      }

      i++;
    }

    console.log("Bracket content:", JSON.stringify(bracketContent));
    console.log("Top-level comma count:", commaCount);
    return commaCount;
  }
}
