import * as ls from "vscode-languageserver/node";
import { CompletionContext, CompletionType } from "../types";
import { BaseCompletionStrategy } from "./base";
import { SymbolSelector } from "../symbolSelector";

/**
 * Strategy for root level completions
 */
export class RootLevelStrategy extends BaseCompletionStrategy {
  private symbolSelector: SymbolSelector;

  constructor(symbolSelector: SymbolSelector) {
    super();
    this.symbolSelector = symbolSelector;
  }

  public canHandle(context: CompletionContext): boolean {
    return context.type === CompletionType.ROOT_LEVEL;
  }

  public getCompletions(context: CompletionContext): ls.CompletionItem[] {
    try {
      const completions = this.symbolSelector.selectRootLevelSymbols(context.document.uri, context.position);

      return this.filterCompletions(completions, context);
    } catch (error) {
      console.error("Error in RootLevelStrategy:", error);
      return this.createEmptyResult();
    }
  }
}
