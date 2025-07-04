import * as ls from "vscode-languageserver/node";
import { BuiltinSymbolType } from "./types";
import { CompletionConfig } from "./config";

/**
 * Consolidated symbol selection with settings applied
 * Replaces 8+ duplicate SelectBuiltin* functions
 */
export class SymbolSelector {
  private config: CompletionConfig;
  private symbolCache: { [id: string]: any[] };

  constructor(config: CompletionConfig, symbolCache: { [id: string]: any[] }) {
    this.config = config;
    this.symbolCache = symbolCache;
  }

  /**
   * Select builtin symbols of specified type with settings applied
   */
  public selectBuiltinSymbols(type: BuiltinSymbolType): ls.CompletionItem[] {
    const symbols = this.symbolCache[type];
    if (!symbols || symbols.length === 0) {
      return [];
    }

    try {
      // Apply settings-based transformations
      switch (type) {
        case BuiltinSymbolType.GLOBAL:
          return this.applyGlobalSettings(this.getCompletionItems(symbols));

        case BuiltinSymbolType.KEYWORDS:
          return this.applyKeywordSettings(this.getCompletionItems(symbols));

        case BuiltinSymbolType.EVENTS:
          return this.applyEventSettings(this.getCompletionItems(symbols));

        case BuiltinSymbolType.ROOT_THIS:
          return this.config.shouldShowThisCompletions() ? this.getCompletionItems(symbols) : [];

        case BuiltinSymbolType.ROOT_THIS_CHILDREN:
          return this.config.shouldShowThisCompletions() ? this.getCompletionItems(symbols) : [];

        default:
          return this.getCompletionItems(symbols);
      }
    } catch (error) {
      console.error(`Error selecting builtin symbols of type ${type}:`, error);
      return [];
    }
  }

  /**
   * Select document symbols with scope filtering
   */
  public selectDocumentSymbols(uri: string, position: ls.Position): ls.CompletionItem[] {
    try {
      const symbols = this.symbolCache[uri];
      if (!symbols || symbols.length === 0) {
        return [];
      }

      // Apply scope filtering (this would need to be implemented based on the existing GetSymbolsOfScope logic)
      const scopedSymbols = this.filterSymbolsByScope(symbols, position);
      return this.getCompletionItems(scopedSymbols);
    } catch (error) {
      console.error(`Error selecting document symbols for ${uri}:`, error);
      return [];
    }
  }

  /**
   * Select structure symbols for type annotations
   */
  public selectStructSymbols(uri: string): ls.CompletionItem[] {
    try {
      const symbols = this.symbolCache[uri];
      if (!symbols || symbols.length === 0) {
        return [];
      }

      const structSymbols = symbols.filter((symbol) => symbol.kind === ls.CompletionItemKind.Struct);
      return this.getCompletionItems(structSymbols);
    } catch (error) {
      console.error(`Error selecting struct symbols for ${uri}:`, error);
      return [];
    }
  }

  /**
   * Get combined symbols for root level completions
   */
  public selectRootLevelSymbols(uri: string, position: ls.Position): ls.CompletionItem[] {
    try {
      const completions: ls.CompletionItem[] = [];

      // Document symbols
      completions.push(...this.selectDocumentSymbols(uri, position));

      // Built-in symbols
      completions.push(...this.selectBuiltinSymbols(BuiltinSymbolType.GLOBAL));
      completions.push(...this.selectBuiltinSymbols(BuiltinSymbolType.ROOT));
      completions.push(...this.selectBuiltinSymbols(BuiltinSymbolType.KEYWORDS));
      completions.push(...this.selectBuiltinSymbols(BuiltinSymbolType.ROOT_THIS));

      // Conditional symbols
      if (this.config.shouldShowEventSnippets()) {
        completions.push(...this.selectBuiltinSymbols(BuiltinSymbolType.EVENTS));
      }

      if (this.config.shouldShowThisCompletions()) {
        completions.push(...this.selectBuiltinSymbols(BuiltinSymbolType.ROOT_THIS_CHILDREN));
      }

      return completions;
    } catch (error) {
      console.error(`Error selecting root level symbols:`, error);
      return [];
    }
  }

  private applyGlobalSettings(items: ls.CompletionItem[]): ls.CompletionItem[] {
    if (this.config.shouldEnableGlobalProcedureSnippets()) {
      return this.getSnippetCompletionItems(this.symbolCache[BuiltinSymbolType.GLOBAL]);
    }
    return items;
  }

  private applyKeywordSettings(items: ls.CompletionItem[]): ls.CompletionItem[] {
    if (this.config.shouldUseLowercaseKeywords()) {
      return items.map((item) => ({
        ...item,
        insertText: item.insertText?.toLowerCase() || item.label.toLowerCase(),
        label: item.label.toLowerCase(),
      }));
    }
    return items;
  }

  private applyEventSettings(items: ls.CompletionItem[]): ls.CompletionItem[] {
    // For events, we might want to return snippets instead of plain completions
    return this.getSnippetCompletionItems(this.symbolCache[BuiltinSymbolType.EVENTS]);
  }

  private getCompletionItems(symbols: any[]): ls.CompletionItem[] {
    if (!symbols || symbols.length === 0) {
      return [];
    }

    // Import VizSymbol dynamically to avoid circular dependency
    const { VizSymbol } = require("../vizsymbol");
    return VizSymbol.GetLanguageServerCompletionItems(symbols);
  }

  private getSnippetCompletionItems(symbols: any[]): ls.CompletionItem[] {
    if (!symbols || symbols.length === 0) {
      return [];
    }

    // Import VizSymbol dynamically to avoid circular dependency
    const { VizSymbol } = require("../vizsymbol");
    return VizSymbol.GetLanguageServerSnippetCompletionItems(symbols);
  }

  private filterSymbolsByScope(symbols: any[], position: ls.Position): any[] {
    try {
      if (!symbols || symbols.length === 0) {
        return [];
      }

      console.log("SymbolSelector: Applying scope filtering for position:", position.line, position.character);

      // Create symbol tree
      const symbolTree = this.createSymbolTree(symbols);

      if (!symbolTree) {
        console.log("SymbolSelector: No symbol tree created, returning all non-hidden symbols");
        return symbols.filter((symbol) => symbol.visibility !== "hidden");
      }

      // Find the direct parent containing the cursor position
      const parentNode = symbolTree.findDirectParent(position);

      // Get all parent symbols and their direct children (this is the scope)
      const scopedSymbols = parentNode.getAllParentsAndTheirDirectChildren();

      // Filter out hidden symbols
      const filteredSymbols = scopedSymbols.filter((symbol) => symbol.visibility !== "hidden");

      console.log(
        `SymbolSelector: Scope filtering: ${symbols.length} -> ${scopedSymbols.length} -> ${filteredSymbols.length} symbols`,
      );

      return filteredSymbols;
    } catch (error) {
      console.error("Error filtering symbols by scope:", error);
      return symbols.filter((symbol) => symbol.visibility !== "hidden");
    }
  }

  /**
   * Create a symbol tree for scope resolution
   * Implements the same logic as SymbolResolver
   */
  private createSymbolTree(symbols: any[]): SymbolTreeNode | null {
    if (!symbols || symbols.length === 0) {
      return null;
    }

    // Sort symbols by start position
    const sortedSymbols = symbols.sort((a, b) => {
      const diff = a.symbolRange.start.line - b.symbolRange.start.line;
      if (diff !== 0) return diff;
      return a.symbolRange.start.character - b.symbolRange.start.character;
    });

    const root = new SymbolTreeNode();

    for (const symbol of sortedSymbols) {
      root.insertIntoTree(symbol);
    }

    return root;
  }
}

/**
 * Symbol tree node for scope resolution in SymbolSelector
 * Same implementation as in SymbolResolver
 */
class SymbolTreeNode {
  parent: SymbolTreeNode | null = null;
  children: SymbolTreeNode[] = [];
  data: any = null;

  public insertIntoTree(symbol: any): boolean {
    if (this.data !== null && !this.isPositionInRange(this.data.symbolRange, symbol.symbolRange.start)) {
      return false;
    }

    for (const child of this.children) {
      if (child.insertIntoTree(symbol)) {
        return true;
      }
    }

    const newNode = new SymbolTreeNode();
    newNode.data = symbol;
    newNode.parent = this;
    this.children.push(newNode);

    return true;
  }

  public findDirectParent(position: ls.Position): SymbolTreeNode {
    if (this.data !== null && !this.isPositionInRange(this.data.symbolRange, position)) {
      return null;
    }

    for (const child of this.children) {
      const found = child.findDirectParent(position);
      if (found !== null) {
        return found;
      }
    }

    return this;
  }

  public getAllParentsAndTheirDirectChildren(): any[] {
    let symbols: any[];

    if (this.parent !== null) {
      symbols = this.parent.getAllParentsAndTheirDirectChildren();
    } else {
      symbols = [];
    }

    const childSymbols = this.children.map((child) => child.data).filter((data) => data !== null);
    return symbols.concat(childSymbols);
  }

  private isPositionInRange(range: any, position: ls.Position): boolean {
    if (range.start.line > position.line) return false;
    if (range.end.line < position.line) return false;
    if (range.start.line === position.line && range.start.character >= position.character) return false;
    if (range.end.line === position.line && range.end.character <= position.character) return false;
    return true;
  }
}
