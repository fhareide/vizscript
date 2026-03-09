import * as ls from "vscode-languageserver/node";
import { CompletionContext, CompletionType } from "../types";
import { BaseCompletionStrategy } from "./base";

/**
 * Strategy for completions inside string arguments of known methods.
 * Uses the cached scene tree to suggest container names, function plugin names, etc.
 */
export class StringArgumentStrategy extends BaseCompletionStrategy {
  private sceneTree: any = null;

  public updateSceneTree(tree: any): void {
    this.sceneTree = tree;
  }

  public canHandle(context: CompletionContext): boolean {
    return context.type === CompletionType.STRING_ARGUMENT;
  }

  public getCompletions(context: CompletionContext): ls.CompletionItem[] {
    if (!context.stringArgumentInfo || !this.sceneTree) {
      return this.createEmptyResult();
    }

    const { methodName, partialValue } = context.stringArgumentInfo;

    switch (methodName) {
      case "FindSubContainer":
      case "FindSubContainers":
        return this.getSubContainerCompletions(context, partialValue);
      case "FindContainer":
        return this.getAllContainerCompletions(partialValue);
      case "FindSiblingSubContainer":
        return this.getSiblingCompletions(context, partialValue);
      case "GetFunctionPluginInstance":
        return this.getFunctionPluginCompletions(context, partialValue);
      default:
        return this.createEmptyResult();
    }
  }

  /**
   * Suggest child container names for FindSubContainer.
   * Handles $-separated chained lookups (e.g. "name1$name2").
   */
  private getSubContainerCompletions(context: CompletionContext, partialValue: string): ls.CompletionItem[] {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return this.createEmptyResult();

    // Handle $-separated chain: resolve each segment to narrow the search scope
    const segments = partialValue.split("$");
    const lastSegment = segments[segments.length - 1];
    const resolvedSegments = segments.slice(0, -1);

    let searchScope = this.getAllNodesArray();

    // If editing within a container script, start from that container's children
    const currentContainer = this.resolveCurrentContainer(context);
    if (currentContainer) {
      searchScope = this.getAllDescendants(currentContainer);
    }

    // Walk the $-chain to narrow scope
    for (const seg of resolvedSegments) {
      const match = searchScope.find((n: any) => n.name === seg);
      if (match) {
        searchScope = this.getAllDescendants(match);
      } else {
        return this.createEmptyResult();
      }
    }

    return this.nodesToCompletions(searchScope, lastSegment, "container");
  }

  /**
   * Suggest all container names in the scene for FindContainer / Scene.FindContainer.
   */
  private getAllContainerCompletions(partialValue: string): ls.CompletionItem[] {
    const allNodes = this.getAllNodesArray();

    // Handle $-separated chain
    const segments = partialValue.split("$");
    const lastSegment = segments[segments.length - 1];
    const resolvedSegments = segments.slice(0, -1);

    let searchScope = allNodes;

    for (const seg of resolvedSegments) {
      const match = searchScope.find((n: any) => n.name === seg);
      if (match) {
        searchScope = this.getAllDescendants(match);
      } else {
        return this.createEmptyResult();
      }
    }

    return this.nodesToCompletions(searchScope, lastSegment, "container");
  }

  /**
   * Suggest sibling container names for FindSiblingSubContainer.
   */
  private getSiblingCompletions(context: CompletionContext, partialValue: string): ls.CompletionItem[] {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return this.createEmptyResult();

    const currentContainer = this.resolveCurrentContainer(context);
    if (!currentContainer) {
      return this.getAllContainerCompletions(partialValue);
    }

    // Find siblings: containers with the same parent path
    const lastSlash = currentContainer.treePath?.lastIndexOf("/");
    let siblings: any[] = [];

    if (lastSlash > 0) {
      const parentPath = currentContainer.treePath.substring(0, lastSlash);
      siblings = Object.values(flatMap).filter((n: any) => {
        if (!n.treePath) return false;
        const nParentSlash = n.treePath.lastIndexOf("/");
        if (nParentSlash <= 0) return false;
        return n.treePath.substring(0, nParentSlash) === parentPath;
      });
    } else {
      // Top-level container: siblings are other top-level containers
      siblings = Object.values(flatMap).filter((n: any) => n.treePath && !n.treePath.includes("/"));
    }

    // Also search sub-containers of siblings (as per Viz docs)
    let searchScope: any[] = [];
    for (const sib of siblings) {
      searchScope.push(sib);
      searchScope = searchScope.concat(this.getAllDescendants(sib));
    }

    return this.nodesToCompletions(searchScope, partialValue, "container");
  }

  /**
   * Suggest function plugin names for GetFunctionPluginInstance.
   */
  private getFunctionPluginCompletions(context: CompletionContext, partialValue: string): ls.CompletionItem[] {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return this.createEmptyResult();

    const currentContainer = this.resolveCurrentContainer(context);
    if (!currentContainer) {
      // Fallback: list all function plugins across the scene
      return this.getAllFunctionPluginCompletions(partialValue);
    }

    const functionPlugins: string[] = (currentContainer.plugins || [])
      .filter((p: any) => p.type === "FUNCTION" && p.name)
      .map((p: any) => p.name);

    return functionPlugins
      .filter((name: string) => name.toLowerCase().startsWith(partialValue.toLowerCase()))
      .map((name: string) => ({
        label: name,
        kind: ls.CompletionItemKind.Function,
        detail: `Function plugin on ${currentContainer.name}`,
        insertText: name,
        sortText: "0" + name,
      }));
  }

  private getAllFunctionPluginCompletions(partialValue: string): ls.CompletionItem[] {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return this.createEmptyResult();

    const seen = new Set<string>();
    const items: ls.CompletionItem[] = [];

    for (const node of Object.values(flatMap) as any[]) {
      for (const plugin of node.plugins || []) {
        if (plugin.type === "FUNCTION" && plugin.name && !seen.has(plugin.name)) {
          seen.add(plugin.name);
          if (plugin.name.toLowerCase().startsWith(partialValue.toLowerCase())) {
            items.push({
              label: plugin.name,
              kind: ls.CompletionItemKind.Function,
              detail: `Function plugin (found on ${node.name})`,
              insertText: plugin.name,
              sortText: "0" + plugin.name,
            });
          }
        }
      }
    }

    return items;
  }

  /**
   * Attempt to resolve which container the current script belongs to
   * by matching the document URI metadata to a vizId in the tree.
   */
  private resolveCurrentContainer(context: CompletionContext): any | null {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return null;

    // The document URI may encode vizId info (e.g. from untitled filenames)
    // For now, we cannot reliably resolve this without metadata from the client.
    // Return null to fall back to scene-wide completions.
    return null;
  }

  private getAllNodesArray(): any[] {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return [];
    return Object.values(flatMap);
  }

  private getAllDescendants(node: any): any[] {
    const results: any[] = [];
    if (!node.children) return results;
    for (const child of node.children) {
      results.push(child);
      results.push(...this.getAllDescendants(child));
    }
    return results;
  }

  private nodesToCompletions(nodes: any[], prefix: string, kind: string): ls.CompletionItem[] {
    const seen = new Set<string>();
    const items: ls.CompletionItem[] = [];

    for (const node of nodes) {
      const name = node.name;
      if (!name || seen.has(name)) continue;
      seen.add(name);

      if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) {
        continue;
      }

      const functionPlugins = (node.plugins || [])
        .filter((p: any) => p.type === "FUNCTION" && p.name)
        .map((p: any) => p.name);

      const detailParts: string[] = [`[${node.treePath}]`];
      if (functionPlugins.length > 0) {
        detailParts.push(`Functions: ${functionPlugins.join(", ")}`);
      }
      if (node.geometryVizId) {
        detailParts.push(`Geometry: ${node.geometryVizId}`);
      }

      items.push({
        label: name,
        kind: ls.CompletionItemKind.Value,
        detail: detailParts.join(" | "),
        documentation: `Container ${node.vizId} at tree path ${node.treePath}`,
        insertText: name,
        sortText: "0" + (node.treePath || "").padStart(20, "0") + name,
      });
    }

    return items;
  }
}
