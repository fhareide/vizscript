import * as ls from "vscode-languageserver/node";
import { CompletionContext, CompletionType } from "../types";
import { BaseCompletionStrategy } from "./base";

/**
 * Strategy for variable declaration completions (dim statements)
 */
export class VariableDeclarationStrategy extends BaseCompletionStrategy {
  public canHandle(context: CompletionContext): boolean {
    return context.type === CompletionType.VARIABLE_DECLARATION;
  }

  public getCompletions(context: CompletionContext): ls.CompletionItem[] {
    try {
      // No suggestions when declaring variables
      return this.createEmptyResult();
    } catch (error) {
      console.error("Error in VariableDeclarationStrategy:", error);
      return this.createEmptyResult();
    }
  }
}
