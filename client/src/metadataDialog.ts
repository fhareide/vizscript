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

/** Fields whose change is significant enough to auto-open the diff view */
const SIGNIFICANT_FIELDS = ["scenePath", "scriptType"];

/**
 * Shows a QuickPick to prompt the user about metadata updates.
 * If a significant field (scenePath, scriptType) changed, the diff view
 * opens automatically before the QuickPick appears.
 */
export async function showMetadataUpdateDialog(options: MetadataDialogOptions): Promise<MetadataDialogResult> {
  const { currentMetadata, suggestedMetadata, scriptName } = options;

  const comparison = createMetadataComparison(currentMetadata, suggestedMetadata);
  const hasChanges = comparison !== "No changes detected";

  if (!hasChanges) {
    return { action: "keep", metadata: currentMetadata };
  }

  // Auto-open diff for significant field changes so the user can review while deciding
  const hasSignificantChange = SIGNIFICANT_FIELDS.some(
    (f) => JSON.stringify(currentMetadata?.[f]) !== JSON.stringify(suggestedMetadata?.[f]),
  );
  if (hasSignificantChange) {
    await showDetailedMetadataView(currentMetadata, suggestedMetadata);
  }

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
      await showDetailedMetadataView(currentMetadata, suggestedMetadata);
      return showMetadataUpdateDialog(options);
    default:
      return { action: "skip" };
  }
}

/**
 * Shows a QuickPick when metadata exists but is missing required fields.
 * Replaces the inline toast in commands.ts.
 */
export async function showIncompleteMetadataDialog(
  scriptName: string,
  missingFields: string[],
): Promise<{ action: "update" | "keep" | "skip" }> {
  const items: vscode.QuickPickItem[] = [
    {
      label: "$(sync) Update Metadata",
      description: "Auto-complete the missing fields",
      detail: `Missing: ${missingFields.join(", ")}`,
    },
    {
      label: "$(check) Keep Existing",
      description: "Keep current metadata unchanged",
      detail: "Missing fields will not be filled in",
    },
    {
      label: "$(x) Skip",
      description: "Continue without changes",
      detail: "Metadata will remain incomplete",
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `Metadata Incomplete for "${scriptName}"`,
    placeHolder: "Some required metadata fields are missing:",
    ignoreFocusOut: true,
  });

  if (!selected) {
    return { action: "skip" };
  }

  switch (selected.label) {
    case "$(sync) Update Metadata":
      return { action: "update" };
    case "$(check) Keep Existing":
      return { action: "keep" };
    default:
      return { action: "skip" };
  }
}

/**
 * Shows a blocking modal warning when the metadata scenePath does not match
 * the scene currently loaded in Viz. Replaces the inline showWarningMessage in commands.ts.
 */
export async function showScenePathMismatchDialog(
  detail: string,
): Promise<{ action: "add" | "replace" | "continueAnyway" | "cancel" }> {
  const choice = await vscode.window.showWarningMessage(
    "Scene Path Mismatch",
    {
      modal: true,
      detail,
    },
    { title: "Add to Metadata" },
    { title: "Replace Metadata" },
    { title: "Continue Anyway" },
    { title: "Cancel", isCloseAffordance: true },
  );

  switch (choice?.title) {
    case "Add to Metadata":
      return { action: "add" };
    case "Replace Metadata":
      return { action: "replace" };
    case "Continue Anyway":
      return { action: "continueAnyway" };
    default:
      return { action: "cancel" };
  }
}

/**
 * Shows a non-modal toast when no metadata is found during the set/compile flow.
 * Replaces the inline showInformationMessage in commands.ts.
 */
export async function showNoMetadataSetFlowDialog(): Promise<{ action: "add" | "skip" }> {
  const choice = await vscode.window.showInformationMessage(
    "No metadata found. Add metadata to track this script?",
    {
      modal: false,
      detail: "Metadata helps track script relationships with Viz scenes and enables better version control.",
    },
    { title: "Add Metadata" },
    { title: "Skip", isCloseAffordance: true },
  );

  return choice?.title === "Add Metadata" ? { action: "add" } : { action: "skip" };
}

/**
 * Shows a non-modal toast when no metadata is found during the open/fetch flow.
 */
export async function showMetadataInjectionDialog(
  scriptName: string,
): Promise<{ inject: boolean; dontAskAgain: boolean }> {
  const choice = await vscode.window.showInformationMessage(
    `No metadata found for "${scriptName}". Add metadata to track this script?`,
    {
      modal: false,
    },
    "Add Metadata",
    "Always Add",
    "Skip",
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
 * Shows an input box to set or update the filePath metadata field.
 */
export async function showFilePathDialog(
  currentFilePath: string = "",
  scriptName: string,
  suggestedPath?: string,
): Promise<string | null> {
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
 * Shows a read-only view of metadata differences beside the current editor.
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
 * Creates a brief summary string of metadata field differences.
 */
function createMetadataComparison(current: any, suggested: any): string {
  const changes: string[] = [];

  const allKeys = new Set([...Object.keys(current || {}), ...Object.keys(suggested || {})]);
  const excludeFromDisplay = ["UUID"];
  const deprecatedFields = ["lastModified"];

  for (const key of allKeys) {
    if (excludeFromDisplay.includes(key)) {
      continue;
    }

    const currentValue = current?.[key];
    const suggestedValue = suggested?.[key];

    if (deprecatedFields.includes(key) && currentValue !== undefined && currentValue !== null) {
      changes.push(`• Remove deprecated field ${key}: ${formatValue(currentValue)}`);
      continue;
    }

    if (JSON.stringify(currentValue) !== JSON.stringify(suggestedValue)) {
      if (currentValue === undefined || currentValue === null) {
        changes.push(`• Add ${key}: ${formatValue(suggestedValue)}`);
      } else if (suggestedValue === undefined || suggestedValue === null) {
        changes.push(`• Remove ${key}: ${formatValue(currentValue)}`);
      } else {
        changes.push(`• Update ${key}: ${formatValue(currentValue)} → ${formatValue(suggestedValue)}`);
      }
    }
  }

  if (changes.length > 0) {
    changes.push("", "Note: UUID is preserved");
  }

  return changes.length > 0 ? changes.join("\n") : "No changes detected";
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return "(empty)";
  if (value === "") return "(empty string)";
  if (Array.isArray(value)) return `[${value.map((v) => `"${v}"`).join(", ")}]`;
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

/**
 * Creates a verbose change description for the full diff view.
 */
function createDetailedChanges(current: any, suggested: any): string {
  const changes: string[] = [];

  const allKeys = new Set([...Object.keys(current || {}), ...Object.keys(suggested || {})]);

  for (const key of allKeys) {
    const currentValue = current?.[key];
    const suggestedValue = suggested?.[key];

    if (JSON.stringify(currentValue) !== JSON.stringify(suggestedValue)) {
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
