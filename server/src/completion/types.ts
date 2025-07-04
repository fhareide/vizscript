import * as ls from "vscode-languageserver/node";

// Enums for better type safety
export enum CompletionType {
  VARIABLE_DECLARATION = "variable_declaration",
  FUNCTION_DECLARATION = "function_declaration",
  EVENT_DECLARATION = "event_declaration",
  ASSIGNMENT = "assignment",
  TYPE_ANNOTATION = "type_annotation",
  MEMBER_ACCESS = "member_access",
  ROOT_LEVEL = "root_level",
}

export enum BuiltinSymbolType {
  BUILTIN = "builtin",
  ROOT = "builtin_root",
  GLOBAL = "builtin_global",
  KEYWORDS = "builtin_keywords",
  EVENTS = "builtin_events",
  ROOT_THIS = "builtin_root_this",
  ROOT_THIS_CHILDREN = "builtin_root_this_children",
}

export enum ResolutionMode {
  COMPLETION = "completion",
  DEFINITION = "definition",
  SIGNATURE = "signature",
}

// Interfaces for better structure
export interface ParseResult {
  cleanLine: string;
  memberChain: string[];
  context: CompletionType;
  hasOpenBracket: boolean;
  bracketContent: string;
}

export interface CompletionContext {
  type: CompletionType;
  line: string;
  position: ls.Position;
  memberChain: string[];
  isSignatureHelp: boolean;
  document: {
    uri: string;
    languageId: string;
  };
}

export interface SymbolResolutionResult {
  symbol: any; // VizSymbol type
  children: any[]; // VizSymbol[] type
  isResolved: boolean;
  error?: string;
}

export interface CompletionStrategy {
  getCompletions(context: CompletionContext): ls.CompletionItem[];
  canHandle(context: CompletionContext): boolean;
}

export interface VizScriptSettings {
  enableAutoComplete: boolean;
  showThisCompletionsOnRoot: boolean;
  showEventSnippetCompletionsOnRoot: boolean;
  keywordLowercase: boolean;
  enableSignatureHelp: boolean;
  enableDefinition: boolean;
  enableGlobalProcedureSnippets: boolean;
  compiler: VizScriptCompilerSettings;
}

export interface VizScriptCompilerSettings {
  hostName: string;
  hostPort: number;
  liveSyntaxChecking: boolean;
}
