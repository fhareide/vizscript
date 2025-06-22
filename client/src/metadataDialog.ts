import * as vscode from "vscode";

export interface MetadataDialogOptions {
  currentMetadata: any;
  suggestedMetadata: any;
  scriptName: string;
}

export interface MetadataDialogResult {
  action: "keep" | "update" | "skip" | "setFilePath";
  metadata?: any;
}

/**
 * Shows a dialog to prompt user about metadata updates
 */
export async function showMetadataUpdateDialog(options: MetadataDialogOptions): Promise<MetadataDialogResult> {
  const { currentMetadata, suggestedMetadata, scriptName } = options;

  // Create a detailed comparison to show what would change
  const comparison = createMetadataComparison(currentMetadata, suggestedMetadata);
  const hasChanges = comparison !== "No changes detected";

  if (!hasChanges) {
    // No changes needed, just return keep
    return { action: "keep", metadata: currentMetadata };
  }

  // Create quick pick items with detailed change information
  const items: vscode.QuickPickItem[] = [
    {
      label: "$(sync) Update Metadata",
      description: "Apply the changes shown below",
      detail: comparison,
    },
    {
      label: "$(check) Keep Existing",
      description: "Keep current metadata unchanged",
      detail: "No changes will be made to existing metadata",
    },
    {
      label: "$(info) Show Full Details",
      description: "View complete metadata comparison",
      detail: "Opens a detailed side-by-side comparison",
    },
    {
      label: "$(x) Skip",
      description: "Open without metadata changes",
      detail: "Continue without modifying metadata",
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `Metadata Update Available for "${scriptName}"`,
    placeHolder: "The following changes are suggested:",
    ignoreFocusOut: true,
  });

  if (!selected) {
    return { action: "skip" };
  }

  switch (selected.label) {
    case "$(sync) Update Metadata":
      return { action: "update", metadata: suggestedMetadata };
    case "$(check) Keep Existing":
      return { action: "keep", metadata: currentMetadata };
    case "$(info) Show Full Details":
      // Show detailed view and return to main dialog
      await showDetailedMetadataView(currentMetadata, suggestedMetadata);
      return showMetadataUpdateDialog(options);
    default:
      return { action: "skip" };
  }
}

/**
 * Shows detailed metadata comparison dialog
 */
export async function showMetadataComparisonDialog(options: MetadataDialogOptions): Promise<MetadataDialogResult> {
  const { currentMetadata, suggestedMetadata, scriptName } = options;

  // Create a formatted comparison string
  const comparison = createMetadataComparison(currentMetadata, suggestedMetadata);

  const choice = await vscode.window.showInformationMessage(
    `Metadata exists for "${scriptName}". Would you like to update it?`,
    {
      modal: true,
      detail: comparison,
    },
    { title: "Update" },
    { title: "Keep Current", isCloseAffordance: true },
    { title: "Show Details" },
    { title: "Set File Path" },
  );

  switch (choice?.title) {
    case "Update":
      return { action: "update", metadata: suggestedMetadata };
    case "Keep Current":
      return { action: "keep", metadata: currentMetadata };
    case "Show Details":
      // Show detailed view and return to main dialog
      await showDetailedMetadataView(currentMetadata, suggestedMetadata);
      return showMetadataUpdateDialog(options);
    case "Set File Path":
      return { action: "setFilePath", metadata: currentMetadata };
    default:
      return { action: "skip" };
  }
}

/**
 * Shows a read-only view of metadata differences
 */
async function showDetailedMetadataView(current: any, suggested: any): Promise<void> {
  const content = `Current Metadata:
${JSON.stringify(current, null, 2)}

Suggested Metadata:
${JSON.stringify(suggested, null, 2)}

Changes:
${createDetailedChanges(current, suggested)}`;

  const document = await vscode.workspace.openTextDocument({
    content,
    language: "json",
  });

  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
}

/**
 * Creates a formatted comparison string showing differences
 */
function createMetadataComparison(current: any, suggested: any): string {
  const changes: string[] = [];

  // Get all keys but exclude UUID from comparison display
  // UUID should never change
  const allKeys = new Set([...Object.keys(current || {}), ...Object.keys(suggested || {})]);
  const excludeFromDisplay = ["UUID"];
  const deprecatedFields = ["lastModified"]; // Fields that will be removed

  for (const key of allKeys) {
    // Skip fields that shouldn't be shown in the comparison
    if (excludeFromDisplay.includes(key)) {
      continue;
    }

    const currentValue = current?.[key];
    const suggestedValue = suggested?.[key];

    // Handle deprecated fields - they will be removed regardless of suggested value
    if (deprecatedFields.includes(key) && currentValue !== undefined && currentValue !== null) {
      changes.push(`• Remove deprecated field ${key}: ${formatValue(currentValue)}`);
      continue;
    }

    if (currentValue !== suggestedValue) {
      if (currentValue === undefined || currentValue === null) {
        changes.push(`• Add ${key}: ${formatValue(suggestedValue)}`);
      } else if (suggestedValue === undefined || suggestedValue === null) {
        changes.push(`• Remove ${key}: ${formatValue(currentValue)}`);
      } else {
        changes.push(`• Update ${key}: ${formatValue(currentValue)} → ${formatValue(suggestedValue)}`);
      }
    }
  }

  // Helper function for formatting values
  function formatValue(value: any): string {
    if (value === null || value === undefined) return "(empty)";
    if (value === "") return "(empty string)";
    if (typeof value === "string") return `"${value}"`;
    return String(value);
  }

  // Add a note about automatic fields
  if (changes.length > 0) {
    changes.push("", "Note: UUID is preserved");
  }

  return changes.length > 0 ? changes.join("\n") : "No changes detected";
}

/**
 * Creates detailed change description
 */
function createDetailedChanges(current: any, suggested: any): string {
  const changes: string[] = [];

  const allKeys = new Set([...Object.keys(current || {}), ...Object.keys(suggested || {})]);

  for (const key of allKeys) {
    const currentValue = current?.[key];
    const suggestedValue = suggested?.[key];

    if (currentValue !== suggestedValue) {
      if (currentValue === undefined) {
        changes.push(`NEW: ${key} will be set to "${suggestedValue}"`);
      } else if (suggestedValue === undefined) {
        changes.push(`REMOVED: ${key} will be removed (was "${currentValue}")`);
      } else {
        changes.push(`UPDATED: ${key} will change from "${currentValue}" to "${suggestedValue}"`);
      }
    }
  }

  return changes.length > 0 ? changes.join("\n") : "No changes would be made";
}

/**
 * Shows a simple confirmation dialog for metadata injection
 */
export async function showMetadataInjectionDialog(
  scriptName: string,
): Promise<{ inject: boolean; dontAskAgain: boolean }> {
  const choice = await vscode.window.showInformationMessage(
    `No metadata found for "${scriptName}". Add default metadata?`,
    {
      modal: false,
    },
    "Add Metadata",
    "Skip",
    "Always Add",
  );

  switch (choice) {
    case "Add Metadata":
      return { inject: true, dontAskAgain: false };
    case "Always Add":
      return { inject: true, dontAskAgain: true };
    default:
      return { inject: false, dontAskAgain: false };
  }
}

/**
 * Shows a dialog to set or update the filePath in metadata
 */
export async function showFilePathDialog(
  currentFilePath: string = "",
  scriptName: string,
  suggestedPath?: string,
): Promise<string | null> {
  const currentDisplay = currentFilePath ? `Current: ${currentFilePath}` : "No file path set";
  const suggestedDisplay = suggestedPath ? `Suggested: ${suggestedPath}` : "";

  const inputBox = await vscode.window.showInputBox({
    title: `Set File Path for "${scriptName}"`,
    prompt: "Enter the relative path where this script should be saved",
    value: currentFilePath || suggestedPath || "",
    placeHolder: "e.g., scripts/myScene/script.vs",
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim() === "") {
        return "File path cannot be empty";
      }
      if (value.includes("\\")) {
        return "Please use forward slashes (/) for file paths";
      }
      return null;
    },
  });

  return inputBox || null;
}

/**
 * Shows metadata validation errors to the user
 */
export async function showMetadataValidationErrors(
  errors: string[],
  scriptName: string,
): Promise<{ action: "fix" | "ignore" | "cancel"; dontAskAgain: boolean }> {
  const choice = await vscode.window.showWarningMessage(
    `Metadata validation errors found in "${scriptName}":`,
    {
      modal: true,
      detail: errors.join("\n"),
    },
    { title: "Fix Automatically" },
    { title: "Ignore Errors" },
    { title: "Always Fix" },
    { title: "Always Ignore" },
    { title: "Cancel", isCloseAffordance: true },
  );

  switch (choice?.title) {
    case "Fix Automatically":
      return { action: "fix", dontAskAgain: false };
    case "Ignore Errors":
      return { action: "ignore", dontAskAgain: false };
    case "Always Fix":
      return { action: "fix", dontAskAgain: true };
    case "Always Ignore":
      return { action: "ignore", dontAskAgain: true };
    default:
      return { action: "cancel", dontAskAgain: false };
  }
}
