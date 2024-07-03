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
    // Normalize and URI-encode the provided content
    const normalizeContent = (text: string) => encodeURIComponent(text.replace(/\r\n/g, "\n").trim());

    const normalizedContent = normalizeContent(content);
    const encodedContent = encodeURIComponent(content);
    const diffUri = Uri.parse(`untitled:${name}${fileExtension}?${encodedContent}`, true);

    // Normalize and URI-encode the active editor content
    const activeEditorContent = activeEditor.document.getText();
    const encodedActiveEditorContent = normalizeContent(activeEditorContent);

    // Compare the encoded contents
    if (normalizedContent === encodedActiveEditorContent) {
      window.showInformationMessage("Scripts are identical");
      return;
    }

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
