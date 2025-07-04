import * as ls from "vscode-languageserver/node";
import { CompletionContext, CompletionStrategy } from "../types";

/**
 * Base abstract class for completion strategies
 */
export abstract class BaseCompletionStrategy implements CompletionStrategy {
  /**
   * Get completions for the given context
   */
  public abstract getCompletions(context: CompletionContext): ls.CompletionItem[];

  /**
   * Check if this strategy can handle the given context
   */
  public abstract canHandle(context: CompletionContext): boolean;

  /**
   * Helper method to create empty completion result
   */
  protected createEmptyResult(): ls.CompletionItem[] {
    return [];
  }

  /**
   * Helper method to filter and validate completions
   */
  protected filterCompletions(completions: ls.CompletionItem[], context: CompletionContext): ls.CompletionItem[] {
    return completions.filter((item) => item && item.label && item.label.trim().length > 0);
  }

  /**
   * Helper method to add debug info to completions
   */
  protected addDebugInfo(completions: ls.CompletionItem[], strategyName: string): ls.CompletionItem[] {
    return completions.map((item) => ({
      ...item,
      data: {
        ...item.data,
        strategy: strategyName,
      },
    }));
  }
}
