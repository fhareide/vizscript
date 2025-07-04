/**
 * Toggle mechanism for switching between old and new completion systems
 */
export class CompletionToggle {
  private static useNewSystem: boolean = false;
  private static useNewSystemForCompletion: boolean = false;
  private static useNewSystemForSignatureHelp: boolean = false;
  private static useNewSystemForDefinition: boolean = false;

  /**
   * Toggle between old and new completion systems
   */
  public static toggleSystem(): void {
    this.useNewSystem = !this.useNewSystem;
    this.useNewSystemForCompletion = this.useNewSystem;
    this.useNewSystemForSignatureHelp = this.useNewSystem;
    this.useNewSystemForDefinition = this.useNewSystem;

    console.log(`Completion system switched to: ${this.useNewSystem ? "NEW" : "OLD"}`);
  }

  /**
   * Toggle only completion handler
   */
  public static toggleCompletion(): void {
    this.useNewSystemForCompletion = !this.useNewSystemForCompletion;
    console.log(`Completion handler: ${this.useNewSystemForCompletion ? "NEW" : "OLD"}`);
  }

  /**
   * Toggle only signature help handler
   */
  public static toggleSignatureHelp(): void {
    this.useNewSystemForSignatureHelp = !this.useNewSystemForSignatureHelp;
    console.log(`Signature help handler: ${this.useNewSystemForSignatureHelp ? "NEW" : "OLD"}`);
  }

  /**
   * Toggle only definition handler
   */
  public static toggleDefinition(): void {
    this.useNewSystemForDefinition = !this.useNewSystemForDefinition;
    console.log(`Definition handler: ${this.useNewSystemForDefinition ? "NEW" : "OLD"}`);
  }

  /**
   * Set specific system states
   */
  public static setSystemState(completion?: boolean, signatureHelp?: boolean, definition?: boolean): void {
    if (completion !== undefined) {
      this.useNewSystemForCompletion = completion;
    }
    if (signatureHelp !== undefined) {
      this.useNewSystemForSignatureHelp = signatureHelp;
    }
    if (definition !== undefined) {
      this.useNewSystemForDefinition = definition;
    }

    console.log(
      `System state updated - Completion: ${this.useNewSystemForCompletion ? "NEW" : "OLD"}, SignatureHelp: ${this.useNewSystemForSignatureHelp ? "NEW" : "OLD"}, Definition: ${this.useNewSystemForDefinition ? "NEW" : "OLD"}`,
    );
  }

  /**
   * Get current system states
   */
  public static getSystemState(): {
    completion: boolean;
    signatureHelp: boolean;
    definition: boolean;
    overall: boolean;
  } {
    return {
      completion: this.useNewSystemForCompletion,
      signatureHelp: this.useNewSystemForSignatureHelp,
      definition: this.useNewSystemForDefinition,
      overall: this.useNewSystem,
    };
  }

  /**
   * Check if new system should be used for completion
   */
  public static shouldUseNewCompletion(): boolean {
    return this.useNewSystemForCompletion;
  }

  /**
   * Check if new system should be used for signature help
   */
  public static shouldUseNewSignatureHelp(): boolean {
    return this.useNewSystemForSignatureHelp;
  }

  /**
   * Check if new system should be used for definition
   */
  public static shouldUseNewDefinition(): boolean {
    return this.useNewSystemForDefinition;
  }

  /**
   * Get status message for display
   */
  public static getStatusMessage(): string {
    const state = this.getSystemState();
    return `VizScript Completion System Status:
- Completion: ${state.completion ? "NEW (Modular)" : "OLD (Legacy)"}
- Signature Help: ${state.signatureHelp ? "NEW (Modular)" : "OLD (Legacy)"}
- Definition: ${state.definition ? "NEW (Modular)" : "OLD (Legacy)"}

Toggle with: 
- Ctrl+Shift+P -> "VizScript: Toggle Completion System"
- Individual toggles available for each feature`;
  }
}
