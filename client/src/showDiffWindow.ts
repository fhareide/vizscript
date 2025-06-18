import {
  Position,
  Uri,
  WorkspaceEdit,
  window,
  workspace,
  Range,
  ExtensionContext,
  commands,
  TextDocument,
} from "vscode";
import { FileService } from "./fileService";

export async function diffWithActiveEditor(
  id: string,
  name: string,
  fileExtension: string,
  content: string,
  context: ExtensionContext,
) {
  const activeEditor = window.activeTextEditor;

  if (!activeEditor) {
    window.showErrorMessage("No active editor found");
    return;
  }

  try {
    const fileService = new FileService();

    // Use the enhanced normalization for comparison
    const normalizedContent = fileService.normalizeForComparison(content);
    const activeEditorContent = activeEditor.document.getText();
    const normalizedActiveContent = fileService.normalizeForComparison(activeEditorContent);

    // Compare the normalized contents
    if (normalizedContent === normalizedActiveContent) {
      window.showInformationMessage("Scripts are identical");
      return;
    }

    // For the actual diff display, use the original content
    const encodedContent = encodeURIComponent(content);
    const diffUri = Uri.parse(`diff:${name}${fileExtension}?${encodedContent}`);

    // Temporarily set the `diffEditor.renderSideBySide` setting to `true`
    const configuration = workspace.getConfiguration("diffEditor");
    await configuration.update("renderSideBySide", true, true);

    // Use the 'vscode.diff' command to show the diff in side-by-side view
    const activeDocumentUri = activeEditor.document.uri;
    await commands.executeCommand("vscode.diff", activeDocumentUri, diffUri, `${name} Comparison`);
  } catch (error) {
    window.showErrorMessage(`Error showing diff window: ${error.message}`);
    throw error;
  }
}
