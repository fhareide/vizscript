import * as ls from "vscode-languageserver/node";
import { ResolutionMode, SymbolResolutionResult } from "./types";

/**
 * Unified symbol resolution for all scenarios
 * Replaces GetItemType, GetDefinitionItem, GetItemForSignature
 */
export class SymbolResolver {
  private symbolCache: { [id: string]: any[] };
  private documentUri: string;
  private scriptType: string;

  constructor(symbolCache: { [id: string]: any[] }, documentUri: string, scriptType: string) {
    this.symbolCache = symbolCache;
    this.documentUri = documentUri;
    this.scriptType = scriptType;
  }

  /**
   * Resolve a symbol chain (e.g., "System.Scene.Camera")
   */
  public resolveSymbolChain(parts: string[], position: ls.Position, mode: ResolutionMode): SymbolResolutionResult {
    try {
      console.log("    === SymbolResolver Debug ===");
      console.log("    Resolving chain:", parts);
      console.log("    Mode:", mode);

      if (!parts || parts.length === 0) {
        console.log("    Empty parts array");
        return { symbol: null, children: [], isResolved: false };
      }

      let currentSymbol: any = null;
      let currentChildren: any[] = [];

      for (let i = 0; i < parts.length; i++) {
        const originalPart = parts[i];
        const part = this.cleanSymbolName(originalPart);
        const isLast = i === parts.length - 1;
        console.log("    Processing part [" + i + "]:", originalPart, "->", part);

        if (i === 0) {
          // Resolve first symbol - pass both original and cleaned names
          const result = this.resolveFirstSymbol(part, position, mode, originalPart);
          console.log("    First symbol resolved:", result.isResolved, result.symbol?.name, result.symbol?.type);
          console.log("    Children count:", result.children?.length || 0);

          if (!result.isResolved) {
            console.log("    Failed to resolve first symbol");
            return result;
          }
          currentSymbol = result.symbol;
          currentChildren = result.children;
        } else {
          // Resolve subsequent symbols from children
          console.log("    Looking for member in", currentChildren.length, "children");
          const result = this.resolveFromChildren(part, currentChildren, position, mode);
          console.log("    Child resolution result:", result.isResolved, result.symbol?.name);

          if (!result.isResolved) {
            console.log("    Failed to resolve child symbol:", part);
            return { symbol: null, children: [], isResolved: false };
          }
          currentSymbol = result.symbol;
          currentChildren = result.children;
          console.log("    New children count:", currentChildren.length);
        }

        // For definition mode, we want the symbol at the last part
        if (mode === ResolutionMode.DEFINITION && isLast) {
          console.log("    Definition mode, returning at last part");
          return { symbol: currentSymbol, children: currentChildren, isResolved: true };
        }
      }

      console.log("    Final symbol:", currentSymbol?.name, "with", currentChildren.length, "children");
      console.log("    === End SymbolResolver Debug ===");
      return { symbol: currentSymbol, children: currentChildren, isResolved: true };
    } catch (error) {
      console.error("Error resolving symbol chain:", error);
      console.log("    === End SymbolResolver Debug (ERROR) ===");
      return {
        symbol: null,
        children: [],
        isResolved: false,
        error: error.message,
      };
    }
  }

  /**
   * Resolve the first symbol in a chain
   */
  private resolveFirstSymbol(
    name: string,
    position: ls.Position,
    mode: ResolutionMode,
    originalName?: string,
  ): SymbolResolutionResult {
    console.log("      Resolving first symbol:", name);

    // Try built-in symbols first
    console.log("      Trying builtin symbols...");
    let result = this.resolveBuiltinSymbol(name, position, mode);
    if (result.isResolved) {
      console.log("      Found in builtin symbols:", result.symbol?.name);
      return result;
    }

    // Try document symbols - pass original name for array indexing detection
    console.log("      Trying document symbols...");
    result = this.resolveDocumentSymbol(name, position, mode, originalName);
    if (result.isResolved) {
      console.log("      Found in document symbols:", result.symbol?.name);
      return result;
    }

    console.log("      Symbol not found anywhere:", name);
    return { symbol: null, children: [], isResolved: false };
  }

  /**
   * Resolve built-in symbols
   */
  private resolveBuiltinSymbol(name: string, position: ls.Position, mode: ResolutionMode): SymbolResolutionResult {
    const symbolSets = ["builtin", "builtin_root", "builtin_root_this", "builtin_global", "builtin_events"];

    // Check for "This" completions if enabled
    if (this.shouldCheckThisCompletions()) {
      symbolSets.push("builtin_root_this_children");
    }

    for (const setName of symbolSets) {
      const symbols = this.symbolCache[setName];
      if (!symbols) continue;

      for (const symbol of symbols) {
        if (symbol.name.toLowerCase() === name.toLowerCase()) {
          return {
            symbol,
            children: symbol.children || [],
            isResolved: true,
          };
        }
      }
    }

    return { symbol: null, children: [], isResolved: false };
  }

  /**
   * Resolve document symbols by type name (for custom structures)
   */
  private resolveDocumentSymbolByType(
    typeName: string,
    position: ls.Position,
    mode: ResolutionMode,
  ): SymbolResolutionResult {
    const symbols = this.symbolCache[this.documentUri];
    if (!symbols) {
      return { symbol: null, children: [], isResolved: false };
    }

    // Look for a structure/type definition with this name
    for (const symbol of symbols) {
      if (symbol.name.toLowerCase() === typeName.toLowerCase() && symbol.kind === ls.CompletionItemKind.Struct) {
        console.log("    Found structure definition:", symbol.name, "with", symbol.children?.length || 0, "children");
        return {
          symbol,
          children: symbol.children || [],
          isResolved: true,
        };
      }
    }

    return { symbol: null, children: [], isResolved: false };
  }

  /**
   * Resolve document symbols
   */
  private resolveDocumentSymbol(
    name: string,
    position: ls.Position,
    mode: ResolutionMode,
    originalName?: string,
  ): SymbolResolutionResult {
    const symbols = this.symbolCache[this.documentUri];
    console.log("        Document symbols available:", symbols?.length || 0);

    if (!symbols) {
      console.log("        No symbols in cache for URI:", this.documentUri);
      return { symbol: null, children: [], isResolved: false };
    }

    // Apply scope filtering for document symbols
    console.log(
      "        All document symbols:",
      symbols.map((s) => `${s.name} (visibility: ${s.visibility || "undefined"})`).slice(0, 15),
    );
    const scopedSymbols = this.getSymbolsInScope(symbols, position);
    console.log("        After scope filtering:", scopedSymbols.length, "symbols");
    console.log("        Scoped symbol names:", scopedSymbols.map((s) => s.name).slice(0, 10));

    for (const symbol of scopedSymbols) {
      console.log("        Checking symbol:", symbol.name, "vs", name);
      if (symbol.name.toLowerCase() === name.toLowerCase()) {
        console.log("        Found matching symbol:", symbol.name, "type:", symbol.type);
        let children = symbol.children || [];

        // Handle array types
        if (this.isArrayType(symbol.type)) {
          // Use original name for array indexing detection if available
          const nameToCheck = originalName || name;
          const isIndexAccess = /\[.+\]$/.test(nameToCheck) && !nameToCheck.endsWith("[]");
          const isGenericArrayAccess = nameToCheck.endsWith("[]");

          console.log(
            "        Array type detected. Is index access:",
            isIndexAccess,
            "Is generic array access:",
            isGenericArrayAccess,
            "for original name:",
            originalName,
            "cleaned name:",
            name,
          );

          if (isIndexAccess || isGenericArrayAccess) {
            // Array element access - return the element type
            const elementType = this.extractArrayElementType(symbol.type);
            console.log("        Getting element type:", elementType);
            const elementSymbol = this.resolveBuiltinSymbol(elementType, position, mode);
            if (elementSymbol.isResolved) {
              console.log("        Found builtin element type with", elementSymbol.children.length, "children");
              children = elementSymbol.children;
            } else {
              // Try document symbols for custom element types
              console.log("        Builtin element type not found, trying document symbols");
              const docElementSymbol = this.resolveDocumentSymbolByType(elementType, position, mode);
              if (docElementSymbol.isResolved) {
                console.log("        Found document element type with", docElementSymbol.children.length, "children");
                children = docElementSymbol.children;
              }
            }
          } else {
            // Array itself access - return Array type
            console.log("        Getting Array type methods");
            const arraySymbol = this.resolveBuiltinSymbol("Array", position, mode);
            children = arraySymbol.children;
          }
        } else if (symbol.type && children.length === 0) {
          // If symbol has no children but has a type, look up the type
          console.log("    Looking up type for symbol:", symbol.name, "type:", symbol.type);

          // First try builtin types
          let typeSymbol = this.resolveBuiltinSymbol(symbol.type, position, mode);
          if (typeSymbol.isResolved) {
            console.log("    Found builtin type symbol with", typeSymbol.children.length, "children");
            children = typeSymbol.children;
          } else {
            console.log("    Builtin type not found, looking up document type:", symbol.type);
            // If not found in builtins, try document symbols (for custom structures)
            typeSymbol = this.resolveDocumentSymbolByType(symbol.type, position, mode);
            if (typeSymbol.isResolved) {
              console.log("    Found document type symbol with", typeSymbol.children.length, "children");
              children = typeSymbol.children;
            } else {
              console.log("    Type not found anywhere:", symbol.type);
            }
          }
        }

        return {
          symbol,
          children,
          isResolved: true,
        };
      }
    }

    return { symbol: null, children: [], isResolved: false };
  }

  /**
   * Resolve symbol from children
   */
  private resolveFromChildren(
    name: string,
    children: any[],
    position: ls.Position,
    mode: ResolutionMode,
  ): SymbolResolutionResult {
    const cleanName = this.cleanSymbolName(name);

    for (const child of children) {
      if (child.name.toLowerCase() === cleanName.toLowerCase()) {
        let childChildren = child.children || [];

        // If child has a type, resolve its children
        if (child.type && childChildren.length === 0) {
          const typeSymbol = this.resolveBuiltinSymbol(child.type, position, mode);
          if (typeSymbol.isResolved) {
            childChildren = typeSymbol.children;
          }
        }

        return {
          symbol: child,
          children: childChildren,
          isResolved: true,
        };
      }
    }

    return { symbol: null, children: [], isResolved: false };
  }

  /**
   * Clean symbol name by removing array notation and function calls
   */
  private cleanSymbolName(name: string): string {
    if (!name) return "";

    let cleaned = name;

    // Remove array[] notation
    const arrayMatch = cleaned.match(/^array\s*\[(.*?)\]/i);
    if (arrayMatch) {
      cleaned = arrayMatch[1];
    }

    // Remove [] suffix
    if (cleaned.endsWith("[]")) {
      cleaned = cleaned.slice(0, -2);
    }

    // Remove brackets for arrays
    const bracketMatch = cleaned.match(/([^.]*)\[.*?\]/);
    if (bracketMatch) {
      cleaned = bracketMatch[1];
    }

    // Remove function call parentheses
    const functionMatch = cleaned.match(/(.*?)\(.*?\)$/);
    if (functionMatch) {
      cleaned = functionMatch[1];
    }

    return cleaned.trim();
  }

  /**
   * Check if type is an array type
   */
  private isArrayType(type: string): boolean {
    return type && type.toLowerCase().startsWith("array");
  }

  /**
   * Extract element type from array type
   */
  private extractArrayElementType(type: string): string {
    const match = type.match(/\[(.*?)\]/);
    return match ? match[1] : "String";
  }

  /**
   * Check if "This" completions should be shown
   */
  private shouldCheckThisCompletions(): boolean {
    // This should be passed from config, but for backward compatibility,
    // we'll return true as the original system does this check elsewhere
    return true;
  }

  /**
   * Get symbols in scope for the given position
   * Implements the same scope logic as the old system's GetSymbolsOfScope function
   */
  private getSymbolsInScope(symbols: any[], position: ls.Position): any[] {
    console.log("      Applying scope filtering for position:", position.line, position.character);

    // Create symbol tree
    const symbolTree = this.createSymbolTree(symbols);

    if (!symbolTree) {
      console.log("      No symbol tree created, returning all non-hidden symbols");
      return symbols.filter((symbol) => symbol.visibility !== "hidden");
    }

    // Find the direct parent containing the cursor position
    const parentNode = symbolTree.findDirectParent(position);

    // Get all parent symbols and their direct children (this is the scope)
    const scopedSymbols = parentNode.getAllParentsAndTheirDirectChildren();

    // Filter out hidden symbols
    const filteredSymbols = scopedSymbols.filter((symbol) => symbol.visibility !== "hidden");

    const hiddenSymbols = scopedSymbols.filter((symbol) => symbol.visibility === "hidden");
    if (hiddenSymbols.length > 0) {
      console.log(
        "        Hidden symbols filtered out:",
        hiddenSymbols.map((s) => s.name),
      );
    }

    console.log(
      `      Scope filtering: ${symbols.length} -> ${scopedSymbols.length} -> ${filteredSymbols.length} symbols`,
    );

    return filteredSymbols;
  }

  /**
   * Create a symbol tree for scope resolution
   * Ports the VizSymbolTree logic from the old system
   */
  private createSymbolTree(symbols: any[]): SymbolTreeNode | null {
    if (!symbols || symbols.length === 0) {
      return null;
    }

    // Sort symbols by start position (same as old system)
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

  /**
   * Check if position is within range
   */
  private isPositionInRange(range: any, position: ls.Position): boolean {
    if (range.start.line > position.line) return false;
    if (range.end.line < position.line) return false;
    if (range.start.line === position.line && range.start.character >= position.character) return false;
    if (range.end.line === position.line && range.end.character <= position.character) return false;
    return true;
  }
}

/**
 * Symbol tree node for scope resolution
 * Ports the VizSymbolTree class from the old system
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
