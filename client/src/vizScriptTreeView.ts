import * as vscode from "vscode";
import * as path from "path";
import { getVizScripts } from "./vizCommunication"; // Assuming the module that fetches scripts
import { VizScriptObject } from "./vizScriptObject"; // Assuming the VizScriptObject class definition
import { getConfig, requestAllScripts } from "./commands";

export class TestView {
  private treeDataProvider: ScriptTreeDataProvider;

  constructor(context: vscode.ExtensionContext) {
    this.treeDataProvider = new ScriptTreeDataProvider(context);
    const view = vscode.window.createTreeView("vizscript-view", {
      treeDataProvider: this.treeDataProvider,
      showCollapseAll: true,
    });
    context.subscriptions.push(view);

    vscode.commands.registerCommand("testView.reveal", async () => {
      const key = await vscode.window.showInputBox({
        placeHolder: "Type the label of the item to reveal",
      });
      if (key) {
        const item = this.treeDataProvider.findItemByKey(key); // Assuming you have a method to find item by key
        if (item) {
          view.reveal(item, { focus: true, select: false, expand: true });
        } else {
          vscode.window.showInformationMessage(`Item with key '${key}' not found.`);
        }
      }
    });

    vscode.commands.registerCommand("testView.changeTitle", async () => {
      const title = await vscode.window.showInputBox({
        prompt: "Type the new title for the Test View",
        placeHolder: view.title,
      });
      if (title) {
        view.title = title;
      }
    });

    // Fetch scripts and update the tree view
    this.treeDataProvider.refresh();
  }
}

class ScriptTreeDataProvider implements vscode.TreeDataProvider<ScriptTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ScriptTreeItem | undefined | null | void> = new vscode.EventEmitter<
    ScriptTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<ScriptTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;
  private scriptObjects: VizScriptObject[];
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async refresh(): Promise<void> {
    try {
      const connectionInfo = await getConfig();
      const scripts = await getVizScripts(connectionInfo.hostName, Number(connectionInfo.hostPort));
      console.log(scripts);
      vscode.window.showInformationMessage("Scripts fetched");

      this._onDidChangeTreeData.fire();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to fetch scripts: ${error}`);
    }
  }

  getTreeItem(element: ScriptTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ScriptTreeItem): Thenable<ScriptTreeItem[]> {
    if (!element) {
      // If no element, return root elements
      return Promise.resolve(this.getRootElements());
    }
  }

  private getRootElements(): ScriptTreeItem[] {
    const rootElements: ScriptTreeItem[] = [];
    this.scriptObjects.forEach((element: VizScriptObject) => {
      if (element.type === "Scene") {
        rootElements.push(new ScriptTreeItem(element, this.context));
      } else if (element.type === "Container") {
        rootElements.push(new ScriptTreeItem(element, this.context));
      }
    });
    return rootElements;
  }

  findItemByKey(key: string): ScriptTreeItem | undefined {
    // Implement logic to find item by key in the tree data
    // This is just a placeholder, you should replace with your actual implementation
    // For example, iterate through tree items and find the matching item
    // or maintain a lookup table for quick access
    // Adjust according to how you structure and access your tree data
    return undefined;
  }
}

class ScriptTreeItem extends vscode.TreeItem {
  constructor(
    public readonly vizObject: VizScriptObject,
    private context: vscode.ExtensionContext,
  ) {
    super(
      vizObject.name,
      vizObject.type === "Scene" ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );

    this.tooltip = `${this.vizObject.name}`;
    this.description = this.vizObject.type;

    // Example path to icons, adjust as per your extension's structure
    this.iconPath = {
      light: this.context.asAbsolutePath(path.join("resources", "light", "folder.svg")),
      dark: this.context.asAbsolutePath(path.join("resources", "dark", "folder.svg")),
    };
  }
}
