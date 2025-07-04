import * as ls from "vscode-languageserver/node";
import { CompletionContext, CompletionStrategy, CompletionType, BuiltinSymbolType } from "../types";
import { BaseCompletionStrategy } from "./base";
import { VariableDeclarationStrategy } from "./variableDeclaration";
import { MemberAccessStrategy } from "./memberAccess";
import { RootLevelStrategy } from "./rootLevel";
import { SymbolSelector } from "../symbolSelector";
import { SymbolResolver } from "../symbolResolver";

/**
 * Simple strategies for specific completion types
 */
class FunctionDeclarationStrategy extends BaseCompletionStrategy {
  public canHandle(context: CompletionContext): boolean {
    return context.type === CompletionType.FUNCTION_DECLARATION;
  }

  public getCompletions(context: CompletionContext): ls.CompletionItem[] {
    // No suggestions when declaring functions or structures
    return this.createEmptyResult();
  }
}

class EventDeclarationStrategy extends BaseCompletionStrategy {
  private symbolSelector: SymbolSelector;

  constructor(symbolSelector: SymbolSelector) {
    super();
    this.symbolSelector = symbolSelector;
  }

  public canHandle(context: CompletionContext): boolean {
    return context.type === CompletionType.EVENT_DECLARATION;
  }

  public getCompletions(context: CompletionContext): ls.CompletionItem[] {
    try {
      // Only event suggestions when declaring sub methods
      const completions = this.symbolSelector.selectBuiltinSymbols(BuiltinSymbolType.EVENTS);
      return this.filterCompletions(completions, context);
    } catch (error) {
      console.error("Error in EventDeclarationStrategy:", error);
      return this.createEmptyResult();
    }
  }
}

class AssignmentStrategy extends BaseCompletionStrategy {
  private symbolSelector: SymbolSelector;

  constructor(symbolSelector: SymbolSelector) {
    super();
    this.symbolSelector = symbolSelector;
  }

  public canHandle(context: CompletionContext): boolean {
    return context.type === CompletionType.ASSIGNMENT;
  }

  public getCompletions(context: CompletionContext): ls.CompletionItem[] {
    try {
      // Suggestions after "="
      const completions = this.symbolSelector.selectRootLevelSymbols(context.document.uri, context.position);
      return this.filterCompletions(completions, context);
    } catch (error) {
      console.error("Error in AssignmentStrategy:", error);
      return this.createEmptyResult();
    }
  }
}

class TypeAnnotationStrategy extends BaseCompletionStrategy {
  private symbolSelector: SymbolSelector;

  constructor(symbolSelector: SymbolSelector) {
    super();
    this.symbolSelector = symbolSelector;
  }

  public canHandle(context: CompletionContext): boolean {
    return context.type === CompletionType.TYPE_ANNOTATION;
  }

  public getCompletions(context: CompletionContext): ls.CompletionItem[] {
    try {
      // Suggestions for type annotations (after "as")
      const completions: ls.CompletionItem[] = [];

      // Document structure types
      completions.push(...this.symbolSelector.selectStructSymbols(context.document.uri));

      // Built-in types
      completions.push(...this.symbolSelector.selectBuiltinSymbols(BuiltinSymbolType.BUILTIN));
      completions.push(...this.symbolSelector.selectBuiltinSymbols(BuiltinSymbolType.ROOT));
      completions.push(...this.symbolSelector.selectBuiltinSymbols(BuiltinSymbolType.KEYWORDS));
      completions.push(...this.symbolSelector.selectBuiltinSymbols(BuiltinSymbolType.ROOT_THIS));

      return this.filterCompletions(completions, context);
    } catch (error) {
      console.error("Error in TypeAnnotationStrategy:", error);
      return this.createEmptyResult();
    }
  }
}

/**
 * Factory for creating completion strategies
 */
export class CompletionStrategyFactory {
  private strategies: CompletionStrategy[] = [];

  constructor(symbolSelector: SymbolSelector, symbolResolver: SymbolResolver) {
    this.strategies = [
      new VariableDeclarationStrategy(),
      new FunctionDeclarationStrategy(),
      new EventDeclarationStrategy(symbolSelector),
      new AssignmentStrategy(symbolSelector),
      new TypeAnnotationStrategy(symbolSelector),
      new MemberAccessStrategy(symbolResolver),
      new RootLevelStrategy(symbolSelector),
    ];
  }

  /**
   * Create appropriate strategy for the given context
   */
  public createStrategy(context: CompletionContext): CompletionStrategy {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(context)) {
        return strategy;
      }
    }

    // Default to root level strategy
    return this.strategies[this.strategies.length - 1];
  }
}
