import { VizScriptSettings } from "./types";

/**
 * Centralized configuration management for completion features
 * Replaces scattered settings checks throughout the codebase
 */
export class CompletionConfig {
  private settings: VizScriptSettings | null = null;

  constructor(settings?: VizScriptSettings) {
    this.settings = settings || null;
  }

  public updateSettings(settings: VizScriptSettings): void {
    this.settings = settings;
  }

  public shouldShowThisCompletions(): boolean {
    return this.settings?.showThisCompletionsOnRoot ?? false;
  }

  public shouldShowEventSnippets(): boolean {
    return this.settings?.showEventSnippetCompletionsOnRoot ?? false;
  }

  public shouldEnableGlobalProcedureSnippets(): boolean {
    return this.settings?.enableGlobalProcedureSnippets ?? false;
  }

  public shouldUseLowercaseKeywords(): boolean {
    return this.settings?.keywordLowercase ?? false;
  }

  public isAutoCompleteEnabled(): boolean {
    return this.settings?.enableAutoComplete ?? true;
  }

  public isSignatureHelpEnabled(): boolean {
    return this.settings?.enableSignatureHelp ?? true;
  }

  public isDefinitionEnabled(): boolean {
    return this.settings?.enableDefinition ?? true;
  }

  public isLiveSyntaxCheckingEnabled(): boolean {
    return this.settings?.compiler?.liveSyntaxChecking ?? false;
  }

  public getCompilerSettings(): { hostName: string; hostPort: number } {
    return {
      hostName: this.settings?.compiler?.hostName ?? "localhost",
      hostPort: this.settings?.compiler?.hostPort ?? 6100,
    };
  }

  public hasSettings(): boolean {
    return this.settings !== null;
  }
}
