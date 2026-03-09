import * as ls from "vscode-languageserver/node";
import { CompletionContext, CompletionType } from "../types";
import { BaseCompletionStrategy } from "./base";

/**
 * Strategy for completions inside string arguments of known methods.
 * Uses the cached scene tree to suggest container names, function plugin names, etc.
 */
export class StringArgumentStrategy extends BaseCompletionStrategy {
  private sceneTree: any = null;

  /**
   * Maps document URI → container vizId so we know which container a script belongs to.
   * Populated when a script is opened in the editor.
   */
  private documentVizIdMap = new Map<string, string>();

  /**
   * Maps vizId → human-readable tree path, e.g. "Main > FS_Stats > FS_Formation".
   * Rebuilt whenever the scene tree is updated.
   */
  private readablePathMap = new Map<string, string>();

  public updateSceneTree(tree: any): void {
    this.sceneTree = tree;
    this.readablePathMap = this.buildReadablePathMap(tree);
  }

  /**
   * Walk the scene tree once and build vizId → "A > B > C" path strings.
   * Includes geometry tree nodes so merged-geometry sub-containers appear correctly.
   */
  private buildReadablePathMap(tree: any): Map<string, string> {
    const map = new Map<string, string>();
    const rootNodes: any[] = tree?.root || [];

    const walk = (node: any, parentPath: string): void => {
      const path = parentPath ? `${parentPath} > ${node.name}` : node.name;
      if (node.vizId) {
        map.set(node.vizId, path);
      }
      for (const child of [...(node.children || []), ...(node.geometryTree || [])]) {
        walk(child, path);
      }
    };

    for (const root of rootNodes) {
      walk(root, "");
    }

    return map;
  }

  public updateDocumentVizId(uri: string, vizId: string): void {
    this.documentVizIdMap.set(uri, vizId);
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
        return this.getAllContainerCompletions(context, partialValue);
      case "FindSiblingSubContainer":
        return this.getSiblingCompletions(context, partialValue);
      case "FindSuperContainer":
        return this.getSuperContainerCompletions(context, partialValue);
      case "GetFunctionPluginInstance":
        return this.getFunctionPluginCompletions(context, partialValue);
      default:
        return this.createEmptyResult();
    }
  }

  // ---------------------------------------------------------------------------
  // FindSubContainer / FindSubContainers
  // ---------------------------------------------------------------------------

  /**
   * Suggest descendant container names for FindSubContainer / FindSubContainers.
   *
   * $-chain rules:
   *   - First segment (before any $): search ALL descendants of the context node.
   *   - After each $: search only the DIRECT CHILDREN of the last resolved node.
   *
   * Example:
   *   FindSubContainer("A")    → all descendants of current container matching "A"
   *   FindSubContainer("A$")   → direct children of node A
   *   FindSubContainer("A$B$") → direct children of node B inside A
   */
  private getSubContainerCompletions(context: CompletionContext, partialValue: string): ls.CompletionItem[] {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return this.createEmptyResult();

    const varMap = this.buildVariableContextMap(context.documentText || "", context.document.uri);
    const currentContainer = this.resolveCurrentContainer(context.document.uri);
    const contextNode = this.resolveObjectChainToNode(
      context.stringArgumentInfo!.objectChain,
      varMap,
      currentContainer,
    );

    const segments = partialValue.split("$");
    const lastSegment = segments[segments.length - 1];
    const resolvedSegments = segments.slice(0, -1);

    // Initial search scope: direct children of the context node (or all nodes if unknown).
    // We use getAllDescendants so the first unqualified segment can match anything in the subtree.
    let searchScope: any[];
    if (contextNode && contextNode !== "scene_root") {
      searchScope = this.getAllDescendants(contextNode as any);
    } else {
      searchScope = this.getAllNodesArray();
    }

    // Walk resolved $-segments — each one narrows to direct children only
    // (including geometry tree nodes at that level).
    for (const seg of resolvedSegments) {
      const match = searchScope.find((n: any) => n.name === seg);
      if (match) {
        searchScope = this.directChildren(match);
      } else {
        return this.createEmptyResult();
      }
    }

    return this.nodesToCompletions(searchScope, lastSegment, "container");
  }

  // ---------------------------------------------------------------------------
  // FindContainer
  // ---------------------------------------------------------------------------

  /**
   * Suggest container names for FindContainer.
   *
   * When called on `Scene` (or from a .vs scene script without a chain):
   *   - First segment: top-level (root) containers only.
   *   - After $: direct children of the resolved segment.
   *
   * When called on a variable that resolves to a node:
   *   - Behaves like FindSubContainer from that node.
   */
  private getAllContainerCompletions(context: CompletionContext, partialValue: string): ls.CompletionItem[] {
    const varMap = this.buildVariableContextMap(context.documentText || "", context.document.uri);
    const currentContainer = this.resolveCurrentContainer(context.document.uri);
    const contextNode = this.resolveObjectChainToNode(
      context.stringArgumentInfo!.objectChain,
      varMap,
      currentContainer,
    );

    const segments = partialValue.split("$");
    const lastSegment = segments[segments.length - 1];
    const resolvedSegments = segments.slice(0, -1);

    // Determine initial scope.
    let searchScope: any[];

    if (contextNode && contextNode !== "scene_root") {
      // Variable with a resolved node — search its descendants.
      searchScope = this.getAllDescendants(contextNode as any);
    } else {
      // Scene.FindContainer or unknown context — all containers in the scene.
      searchScope = this.getAllNodesArray();
    }

    // Walk $-chain: after each $ segment switch to direct children only
    // (including geometry tree nodes at that level).
    for (const seg of resolvedSegments) {
      const match = searchScope.find((n: any) => n.name === seg);
      if (match) {
        searchScope = this.directChildren(match);
      } else {
        return this.createEmptyResult();
      }
    }

    return this.nodesToCompletions(searchScope, lastSegment, "container");
  }

  // ---------------------------------------------------------------------------
  // FindSiblingSubContainer
  // ---------------------------------------------------------------------------

  /**
   * Suggest sibling container names for FindSiblingSubContainer.
   */
  private getSiblingCompletions(context: CompletionContext, partialValue: string): ls.CompletionItem[] {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return this.createEmptyResult();

    const varMap = this.buildVariableContextMap(context.documentText || "", context.document.uri);
    const currentContainer = this.resolveCurrentContainer(context.document.uri);
    const contextNode = this.resolveObjectChainToNode(
      context.stringArgumentInfo!.objectChain,
      varMap,
      currentContainer,
    );

    if (!contextNode || contextNode === "scene_root") {
      return this.getAllContainerCompletions(context, partialValue);
    }

    const node = contextNode as any;
    const lastSlash = node.treePath?.lastIndexOf("/");
    let siblings: any[] = [];

    if (lastSlash > 0) {
      const parentPath = node.treePath.substring(0, lastSlash);
      siblings = Object.values(flatMap).filter((n: any) => {
        if (!n.treePath) return false;
        const nParentSlash = n.treePath.lastIndexOf("/");
        if (nParentSlash <= 0) return false;
        return n.treePath.substring(0, nParentSlash) === parentPath;
      });
    } else {
      siblings = Object.values(flatMap).filter((n: any) => n.treePath && !n.treePath.includes("/"));
    }

    // Include sub-containers of siblings as per Viz docs.
    let searchScope: any[] = [];
    for (const sib of siblings) {
      searchScope.push(sib);
      searchScope = searchScope.concat(this.getAllDescendants(sib));
    }

    return this.nodesToCompletions(searchScope, partialValue, "container");
  }

  // ---------------------------------------------------------------------------
  // FindSuperContainer
  // ---------------------------------------------------------------------------

  /**
   * Suggest the parent container name for FindSuperContainer.
   * Resolves the context node and returns its parent.
   */
  private getSuperContainerCompletions(context: CompletionContext, partialValue: string): ls.CompletionItem[] {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return this.createEmptyResult();

    const varMap = this.buildVariableContextMap(context.documentText || "", context.document.uri);
    const currentContainer = this.resolveCurrentContainer(context.document.uri);
    const contextNode = this.resolveObjectChainToNode(
      context.stringArgumentInfo!.objectChain,
      varMap,
      currentContainer,
    );

    if (!contextNode || contextNode === "scene_root") {
      return this.createEmptyResult();
    }

    const node = contextNode as any;
    if (!node.treePath) return this.createEmptyResult();

    const lastSlash = node.treePath.lastIndexOf("/");
    if (lastSlash <= 0) {
      // Top-level container — no parent in the scene tree.
      return this.createEmptyResult();
    }

    const parentPath = node.treePath.substring(0, lastSlash);
    const parentNode = Object.values(flatMap).find((n: any) => n.treePath === parentPath);
    if (!parentNode) return this.createEmptyResult();

    return this.nodesToCompletions([parentNode], partialValue, "container");
  }

  // ---------------------------------------------------------------------------
  // GetFunctionPluginInstance
  // ---------------------------------------------------------------------------

  /**
   * Suggest function plugin names.
   * Resolves objectChain to pick the correct node; falls back to all scene plugins.
   */
  private getFunctionPluginCompletions(context: CompletionContext, partialValue: string): ls.CompletionItem[] {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return this.createEmptyResult();

    const varMap = this.buildVariableContextMap(context.documentText || "", context.document.uri);
    const currentContainer = this.resolveCurrentContainer(context.document.uri);
    const contextNode = this.resolveObjectChainToNode(
      context.stringArgumentInfo!.objectChain,
      varMap,
      currentContainer,
    );

    if (contextNode && contextNode !== "scene_root") {
      const node = contextNode as any;
      const functionPlugins: string[] = (node.plugins || [])
        .filter((p: any) => p.type === "FUNCTION" && p.name)
        .map((p: any) => p.name);

      return functionPlugins
        .filter((name: string) => name.toLowerCase().startsWith(partialValue.toLowerCase()))
        .map((name: string) => ({
          label: name,
          kind: ls.CompletionItemKind.Function,
          detail: `Function plugin on ${node.name}`,
          insertText: name,
          sortText: "0" + name,
        }));
    }

    // Fallback: list all function plugins across the scene.
    return this.getAllFunctionPluginCompletions(partialValue);
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

  // ---------------------------------------------------------------------------
  // Context resolution helpers
  // ---------------------------------------------------------------------------

  /**
   * Look up which container node the current document's script belongs to.
   * Returns null if the document is not registered or the vizId is not in the scene tree.
   */
  private resolveCurrentContainer(uri: string): any | null {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return null;

    const vizId = this.documentVizIdMap.get(uri);
    if (!vizId) return null;

    return flatMap[vizId] || null;
  }

  /**
   * Resolve the object chain prefix to a scene tree node (or the "scene_root" sentinel).
   *
   * Rules:
   *   - Empty chain                         → currentContainer (bare call in container script)
   *   - Chain starts with "Scene" (case-insensitive) → "scene_root" sentinel
   *   - Chain starts with a known variable  → the variable's resolved node
   *   - Fallback                            → null
   */
  private resolveObjectChainToNode(
    objectChain: string[],
    varMap: Map<string, any>,
    currentContainer: any | null,
  ): any | "scene_root" | null {
    if (objectChain.length === 0) {
      return currentContainer;
    }

    const first = objectChain[0];

    if (first.toLowerCase() === "scene") {
      return "scene_root";
    }

    const resolved = varMap.get(first);
    if (resolved) {
      // Walk additional chain members (e.g. Con.SubCon.FindSubContainer).
      let node = resolved;
      for (let i = 1; i < objectChain.length; i++) {
        const child = (node.children || []).find((c: any) => c.name === objectChain[i]);
        if (!child) return null;
        node = child;
      }
      return node;
    }

    // If the chain refers to something we can't resolve, fall back to null.
    return null;
  }

  /**
   * Scan the document text for container variable assignments and build a map of
   * variableName → VizContainerNode.
   *
   * Patterns recognised (case-insensitive):
   *   dim VarName as Container = [Chain.]FindContainer("Name")
   *   VarName = [Chain.]FindContainer("Name")
   *   dim VarName as Container = [Chain.]FindSubContainer("Name")
   *   VarName = [Chain.]FindSubContainer("Name")
   *   (and FindSubContainers, FindSiblingSubContainer, FindSuperContainer)
   *
   * We resolve single-level: the quoted name is looked up relative to the context
   * that the calling object would provide (Scene → root, known variable → its subtree,
   * bare → any node in scene).
   */
  public buildVariableContextMap(docText: string, uri: string): Map<string, any> {
    const result = new Map<string, any>();
    if (!docText || !this.sceneTree?.flatMap) return result;

    const flatMap = this.sceneTree.flatMap;
    const rootNodes: any[] = this.sceneTree.root || [];

    // Regex: optional "dim VarName as Container =" OR "VarName ="
    // followed by optional chain, then a Find* method with a quoted string.
    const assignPattern =
      /(?:dim\s+(\w+)\s+as\s+container\s*=|(\w+)\s*=)\s*(?:(\w+)\.)*?(FindContainer|FindSubContainer|FindSubContainers|FindSiblingSubContainer|FindSuperContainer)\s*\(\s*"([^"]+)"\s*\)/gi;

    const lines = docText.split(/\r?\n/g);

    // We need a way to look up nodes by name in a given parent scope.
    const findNodeByName = (name: string, scope: any[]): any | null => {
      // Search direct then all descendants.
      const direct = scope.find((n: any) => n.name === name);
      if (direct) return direct;
      for (const node of scope) {
        const found = this.findInDescendants(node, name);
        if (found) return found;
      }
      return null;
    };

    for (const line of lines) {
      // Reset lastIndex before each test (global regex reuse).
      assignPattern.lastIndex = 0;
      const match = assignPattern.exec(line);
      if (!match) continue;

      const varName = match[1] || match[2]; // dim VarName ... or VarName =
      const methodName = match[4];
      const quotedName = match[5];

      if (!varName || !quotedName) continue;

      // Determine the search scope for this assignment.
      // We scan for the object immediately before the method call.
      const callerMatch = /(\w+)\.(FindContainer|FindSubContainer|FindSubContainers|FindSiblingSubContainer|FindSuperContainer)\s*\(/i.exec(
        line,
      );
      let searchScope: any[];

      if (callerMatch) {
        const callerName = callerMatch[1];
        if (callerName.toLowerCase() === "scene") {
          searchScope = rootNodes;
        } else {
          const callerNode = result.get(callerName);
          searchScope = callerNode ? this.getAllDescendants(callerNode) : Object.values(flatMap);
        }
      } else {
        searchScope = Object.values(flatMap);
      }

      // Handle $-separated paths in the quoted value.
      const segments = quotedName.split("$");
      let currentScope = searchScope;
      let resolvedNode: any = null;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const found = findNodeByName(seg, i === 0 ? currentScope : this.directChildren(resolvedNode));
        if (!found) {
          resolvedNode = null;
          break;
        }
        resolvedNode = found;
        currentScope = this.directChildren(resolvedNode);
      }

      if (resolvedNode) {
        result.set(varName, resolvedNode);
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Tree traversal helpers
  // ---------------------------------------------------------------------------

  private getAllNodesArray(): any[] {
    const flatMap = this.sceneTree?.flatMap;
    if (!flatMap) return [];
    return Object.values(flatMap);
  }

  /**
   * Return the combined direct children of a node: regular children + geometry tree roots.
   * This is the correct scope after crossing a $ boundary.
   */
  private directChildren(node: any): any[] {
    return [...(node.children || []), ...(node.geometryTree || [])];
  }

  private getAllDescendants(node: any): any[] {
    const results: any[] = [];
    for (const child of this.directChildren(node)) {
      results.push(child);
      results.push(...this.getAllDescendants(child));
    }
    return results;
  }

  /**
   * Find a node with the given name anywhere in the subtree of `parent`,
   * including geometry tree nodes.
   */
  private findInDescendants(parent: any, name: string): any | null {
    for (const child of this.directChildren(parent)) {
      if (child.name === name) return child;
      const found = this.findInDescendants(child, name);
      if (found) return found;
    }
    return null;
  }

  private nodesToCompletions(nodes: any[], prefix: string, _kind: string): ls.CompletionItem[] {
    // Count how many times each name appears in this scope so we can detect duplicates.
    const nameCount = new Map<string, number>();
    for (const node of nodes) {
      if (node.name) {
        nameCount.set(node.name, (nameCount.get(node.name) || 0) + 1);
      }
    }

    // Deduplicate by vizId (not name) so every unique node is represented.
    const seenVizIds = new Set<string>();
    const items: ls.CompletionItem[] = [];

    for (const node of nodes) {
      const name = node.name;
      if (!name) continue;

      const vizId = node.vizId || node.treePath || name;
      if (seenVizIds.has(vizId)) continue;
      seenVizIds.add(vizId);

      if (prefix && !name.toLowerCase().startsWith(prefix.toLowerCase())) {
        continue;
      }

      const isDuplicate = (nameCount.get(name) || 0) > 1;

      const functionPlugins = (node.plugins || [])
        .filter((p: any) => p.type === "FUNCTION" && p.name)
        .map((p: any) => p.name);

      // Human-readable path + numeric index path as the inline detail.
      const readablePath = this.readablePathMap.get(node.vizId) || "";
      const numericPath = node.treePath || "";
      const detail = readablePath ? `${readablePath}  [${numericPath}]` : numericPath;

      // For duplicate names, append the numeric path to the label so each entry is
      // visually distinct. insertText stays as the plain name (Viz can't distinguish by path).
      const label = isDuplicate ? `${name}  [${numericPath}]` : name;

      const docParts: string[] = [`Path: ${detail}`];
      if (isDuplicate) {
        docParts.push(`⚠ ${nameCount.get(name)} containers named "${name}" exist in this scope — FindSubContainer will return the first match`);
      }
      if (functionPlugins.length > 0) {
        docParts.push(`Functions: ${functionPlugins.join(", ")}`);
      }
      if (node.geometryVizId) {
        docParts.push(`Geometry: ${node.geometryVizId}`);
      }
      docParts.push(`vizId: ${node.vizId}`);

      items.push({
        label,
        kind: ls.CompletionItemKind.Value,
        detail,
        documentation: docParts.join("\n"),
        insertText: name,
        filterText: name,
        sortText: "0" + (node.treePath || "").padStart(20, "0") + name,
      });
    }

    return items;
  }

}
