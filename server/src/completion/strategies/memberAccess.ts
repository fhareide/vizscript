import * as ls from "vscode-languageserver/node";
import { CompletionContext, CompletionType, ResolutionMode } from "../types";
import { BaseCompletionStrategy } from "./base";
import { SymbolResolver } from "../symbolResolver";

/**
 * Strategy for member access completions (dot notation)
 */
export class MemberAccessStrategy extends BaseCompletionStrategy {
  private symbolResolver: SymbolResolver;

  constructor(symbolResolver: SymbolResolver) {
    super();
    this.symbolResolver = symbolResolver;
  }

  public canHandle(context: CompletionContext): boolean {
    return context.type === CompletionType.MEMBER_ACCESS;
  }

  public getCompletions(context: CompletionContext): ls.CompletionItem[] {
    try {
      console.log("--- MemberAccessStrategy Debug ---");
      console.log("Member chain length:", context.memberChain.length);
      console.log("Member chain:", context.memberChain);

      if (context.memberChain.length === 0) {
        console.log("Empty member chain, returning empty result");
        return this.createEmptyResult();
      }

      // Use the member chain to resolve the symbol
      console.log("Resolving symbol chain:", context.memberChain);
      const result = this.symbolResolver.resolveSymbolChain(
        context.memberChain,
        context.position,
        ResolutionMode.COMPLETION,
      );

      console.log("Resolution result:", {
        isResolved: result.isResolved,
        hasSymbol: !!result.symbol,
        symbolName: result.symbol?.name,
        symbolType: result.symbol?.type,
        hasChildren: !!result.children,
        childrenCount: result.children?.length || 0,
      });

      if (!result.isResolved || !result.symbol) {
        console.log("Resolution failed, returning empty result");
        return this.createEmptyResult();
      }

      // Get children completions - use children from resolver result
      console.log("Getting completions from resolver result with", result.children?.length || 0, "children");
      const completions = this.getCompletionItemsFromChildren(result.children || []);
      console.log("Found", completions.length, "completions");

      const filtered = this.filterCompletions(completions, context);
      console.log("After filtering:", filtered.length, "completions");
      console.log("--- End MemberAccessStrategy Debug ---");

      return filtered;
    } catch (error) {
      console.error("Error in MemberAccessStrategy:", error);
      console.log("--- End MemberAccessStrategy Debug (ERROR) ---");
      return this.createEmptyResult();
    }
  }

  private getCompletionItemsFromSymbol(symbol: any): ls.CompletionItem[] {
    try {
      console.log("    Converting symbol to completion items:");
      console.log("    Symbol:", symbol?.name, "type:", symbol?.type);
      console.log("    Has GetLsChildrenItems method:", typeof symbol?.GetLsChildrenItems === "function");
      console.log("    Has children array:", Array.isArray(symbol?.children));
      console.log("    Children count:", symbol?.children?.length || 0);

      if (symbol && symbol.GetLsChildrenItems) {
        console.log("    Using GetLsChildrenItems method");
        const items = symbol.GetLsChildrenItems();
        console.log("    GetLsChildrenItems returned:", items.length, "items");
        return items;
      }

      if (symbol && symbol.children) {
        console.log("    Using VizSymbol.GetLanguageServerCompletionItems");
        console.log(
          "    First few children:",
          symbol.children.slice(0, 3).map((c) => ({ name: c?.name, type: c?.type })),
        );

        // Use VizSymbol to convert children to completion items
        const { VizSymbol } = require("../../vizsymbol");
        const items = VizSymbol.GetLanguageServerCompletionItems(symbol.children);
        console.log("    VizSymbol conversion returned:", items.length, "items");
        return items;
      }

      console.log("    No valid conversion method found, returning empty");
      return [];
    } catch (error) {
      console.error("Error converting symbol to completion items:", error);
      return [];
    }
  }

  private getCompletionItemsFromChildren(children: any[]): ls.CompletionItem[] {
    try {
      console.log("    Converting children array to completion items:");
      console.log("    Children count:", children?.length || 0);

      if (!children || children.length === 0) {
        console.log("    No children to convert");
        return [];
      }

      console.log(
        "    First few children:",
        children.slice(0, 3).map((c) => ({ name: c?.name, type: c?.type })),
      );

      // Use VizSymbol to convert children to completion items
      const { VizSymbol } = require("../../vizsymbol");
      const items = VizSymbol.GetLanguageServerCompletionItems(children);
      console.log("    VizSymbol conversion returned:", items.length, "items");
      return items;
    } catch (error) {
      console.error("Error converting children to completion items:", error);
      return [];
    }
  }
}
