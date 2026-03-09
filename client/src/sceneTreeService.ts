/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as net from "net";
import { ExtensionContext, Uri, workspace } from "vscode";
import type { VizContainerNode, VizPluginRef, VizSceneTree } from "./shared/types";

const NULL_CHAR = String.fromCharCode(0);

function getRegexResult(line: string, regex: RegExp): string[] {
  return regex.exec(line) as string[];
}

/**
 * Parse a single plugin/property reference from the inner property block.
 * Formats:
 *   #vizId*TRANSFORMATION        -> { type: "TRANSFORMATION", vizId: "#vizId" }
 *   #vizId*FUNCTION*Toggle       -> { type: "FUNCTION", name: "Toggle", vizId: "#vizId" }
 *   #vizId*ANIMATION             -> { type: "ANIMATION", vizId: "#vizId" }
 *   GEOM*#geomId                 -> returns null (handled separately)
 *   IMAGE*#imageId               -> returns null (handled separately)
 */
function parsePluginRef(token: string): VizPluginRef | null {
  if (token.startsWith("GEOM*") || token.startsWith("IMAGE*")) {
    return null;
  }

  if (!token.startsWith("#")) {
    return null;
  }

  const parts = token.split("*");
  if (parts.length < 2) {
    return null;
  }

  const vizId = parts[0];

  if (parts.length >= 3 && parts[1] === "FUNCTION") {
    return { type: "FUNCTION", name: parts.slice(2).join("*").trim(), vizId };
  }

  return { type: parts[1], vizId };
}

/**
 * Parse the inner property block: {active visible plugin1 plugin2 ...}
 * Returns { active, visible, plugins, geometryVizId?, imageVizId? }
 */
function parsePropertyBlock(block: string): {
  active: boolean;
  visible: boolean;
  plugins: VizPluginRef[];
  geometryVizId?: string;
  imageVizId?: string;
} {
  const content = block.replace(/^\{/, "").replace(/\}$/, "").trim();
  const tokens = content.split(/\s+/);

  const active = tokens[0] === "1";
  const visible = tokens[1] === "1";
  const plugins: VizPluginRef[] = [];
  let geometryVizId: string | undefined;
  let imageVizId: string | undefined;

  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i].trim();
    if (!token) continue;

    if (token.startsWith("GEOM*#")) {
      geometryVizId = token.substring(5);
    } else if (token.startsWith("IMAGE*#")) {
      imageVizId = token.substring(6);
    } else {
      const ref = parsePluginRef(token);
      if (ref) {
        plugins.push(ref);
      }
    }
  }

  return { active, visible, plugins, geometryVizId, imageVizId };
}

/**
 * Parse a single container block from the TREE GET response.
 * Format: {treePath vizId name [flag] {active visible plugins...}}
 */
function parseContainerBlock(block: string): VizContainerNode | null {
  const content = block.replace(/^\{/, "").replace(/\}$/, "").trim();

  // Find the inner property block (nested braces)
  const innerStart = content.indexOf("{");
  if (innerStart === -1) {
    return null;
  }
  const innerEnd = content.lastIndexOf("}");
  if (innerEnd === -1) {
    return null;
  }

  const prefix = content.substring(0, innerStart).trim();
  const innerBlock = content.substring(innerStart, innerEnd + 1);

  // Parse the prefix: "treePath vizId name [flag]"
  const prefixParts = prefix.split(/\s+/);
  if (prefixParts.length < 3) {
    return null;
  }

  const treePath = prefixParts[0];
  const vizIdRaw = prefixParts[1];
  const vizId = "#" + vizIdRaw;

  // Collect trailing numeric tokens (flags) from the end, working backwards
  const flags: number[] = [];
  let nameEndIndex = prefixParts.length;
  for (let i = prefixParts.length - 1; i >= 3; i--) {
    if (/^-?\d+$/.test(prefixParts[i])) {
      flags.unshift(parseInt(prefixParts[i], 10));
      nameEndIndex = i;
    } else {
      break;
    }
  }

  const name = prefixParts.slice(2, nameEndIndex).join(" ");

  const props = parsePropertyBlock(innerBlock);

  return {
    treePath,
    vizId,
    name,
    flags,
    active: props.active,
    visible: props.visible,
    plugins: props.plugins,
    geometryVizId: props.geometryVizId,
    imageVizId: props.imageVizId,
    children: [],
  };
}

/**
 * Split the raw TREE GET response into individual container blocks.
 * The response is a series of top-level {...} blocks separated by spaces.
 * Each block can contain nested braces (the property sub-block).
 */
function splitTopLevelBlocks(raw: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "{") {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (raw[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        blocks.push(raw.substring(start, i + 1));
        start = -1;
      }
    }
  }

  return blocks;
}

/**
 * Parse the full TREE GET response into a flat array of VizContainerNode.
 */
export function parseTreeResponse(raw: string): VizContainerNode[] {
  const blocks = splitTopLevelBlocks(raw);
  const nodes: VizContainerNode[] = [];

  for (const block of blocks) {
    const node = parseContainerBlock(block);
    if (node) {
      nodes.push(node);
    }
  }

  return nodes;
}

/**
 * Build a nested tree hierarchy from a flat array of nodes using their treePath.
 * Returns both the root array and a flat map by vizId.
 */
export function buildTreeHierarchy(flatNodes: VizContainerNode[]): {
  root: VizContainerNode[];
  flatMap: { [vizId: string]: VizContainerNode };
} {
  const flatMap: { [vizId: string]: VizContainerNode } = {};
  const pathMap: { [treePath: string]: VizContainerNode } = {};

  for (const node of flatNodes) {
    node.children = [];
    flatMap[node.vizId] = node;
    pathMap[node.treePath] = node;
  }

  const root: VizContainerNode[] = [];

  for (const node of flatNodes) {
    const lastSlash = node.treePath.lastIndexOf("/");
    if (lastSlash === -1) {
      root.push(node);
    } else {
      const parentPath = node.treePath.substring(0, lastSlash);
      const parent = pathMap[parentPath];
      if (parent) {
        parent.children.push(node);
      } else {
        root.push(node);
      }
    }
  }

  return { root, flatMap };
}

/**
 * Fetch the geometry tree for a single container and parse it into VizContainerNodes.
 */
function fetchGeometryTree(
  host: string,
  port: number,
  containerVizId: string,
): Promise<VizContainerNode[]> {
  return new Promise((resolve) => {
    let responseData = "";

    const socket = net.createConnection({ port, host }, () => {
      socket.write("1 " + containerVizId + "*GEOM*TREE GET_EX 1 1" + NULL_CHAR);
    });

    socket.on("data", (data) => {
      responseData += data.toString();

      if (responseData.endsWith(NULL_CHAR)) {
        responseData = responseData.replace(NULL_CHAR, "");
        const answer = getRegexResult(responseData, /^([^\s]+)(\s?)(.*)/gi);

        if (answer && answer[3] && !answer[3].startsWith("ERROR")) {
          const flatNodes = parseTreeResponse(answer[3]);
          const { root } = buildTreeHierarchy(flatNodes);
          resolve(root);
        } else {
          resolve([]);
        }
        socket.end();
      }
    });

    socket.on("error", () => {
      resolve([]);
    });

    socket.on("end", () => {
      // handled in data
    });
  });
}

/**
 * Fetch geometry trees for all containers that have a geometryVizId.
 * Processes sequentially to avoid overwhelming the Viz Engine.
 * Parsed geometry nodes are also added to the global flatMap.
 */
export async function fetchGeometryTrees(
  host: string,
  port: number,
  flatMap: { [vizId: string]: VizContainerNode },
): Promise<void> {
  const nodesWithGeom = Object.values(flatMap).filter((n) => n.geometryVizId);

  for (const node of nodesWithGeom) {
    try {
      node.geometryTree = await fetchGeometryTree(host, port, node.vizId);
      addGeometryNodesToFlatMap(node.geometryTree, flatMap);
    } catch (error) {
      console.warn(`Failed to fetch geometry tree for ${node.vizId}:`, error);
      node.geometryTree = [];
    }
  }
}

function addGeometryNodesToFlatMap(
  nodes: VizContainerNode[],
  flatMap: { [vizId: string]: VizContainerNode },
): void {
  for (const node of nodes) {
    flatMap[node.vizId] = node;
    if (node.children.length > 0) {
      addGeometryNodesToFlatMap(node.children, flatMap);
    }
  }
}

/**
 * Fetch the full scene tree from Viz Engine.
 */
export function fetchSceneTree(
  host: string,
  port: number,
  layer: string,
): Promise<{ raw: string; scenePath: string; sceneObjectId: string }> {
  return new Promise((resolve, reject) => {
    let scenePath = "";
    let sceneObjectId = "";
    let treeRaw = "";
    let isReceivingTree = false;

    const socket = net.createConnection({ port, host }, () => {
      socket.write("UUID " + layer + "*UUID GET " + NULL_CHAR);
    });

    socket.on("data", (data) => {
      const chunk = data.toString();

      if (isReceivingTree) {
        treeRaw += chunk;
        if (chunk.endsWith(NULL_CHAR)) {
          treeRaw = treeRaw.replace(/\0/g, "").trim();
          socket.end();
        }
        return;
      }

      const message = chunk.replace(NULL_CHAR, "");
      const answer = getRegexResult(message, /^([^\s]+)(\s?)(.*)/gi);
      if (!answer) return;

      if (answer[1] === "UUID") {
        if (answer[3].startsWith("ERROR")) {
          reject("No scene found in " + layer);
          socket.end();
          return;
        }
        socket.write("PATH FILENAME_FROM_UUID GET " + answer[3] + NULL_CHAR);
      } else if (answer[1] === "PATH") {
        if (answer[3].startsWith("ERROR")) {
          reject("No scene path found for " + layer);
          socket.end();
          return;
        }
        scenePath = answer[3];
        socket.write("OID " + layer + "*OBJECT_ID GET " + NULL_CHAR);
      } else if (answer[1] === "OID") {
        if (answer[3].startsWith("ERROR")) {
          reject("No object ID found for " + layer);
          socket.end();
          return;
        }
        sceneObjectId = answer[3];
        isReceivingTree = true;
        socket.write("TREE " + sceneObjectId + "*TREE GET 1 1" + NULL_CHAR);
      } else if (answer[1] === "TREE") {
        treeRaw = answer[3];
        if (chunk.endsWith(NULL_CHAR)) {
          treeRaw = treeRaw.replace(/\0/g, "").trim();
          socket.end();
        } else {
          isReceivingTree = true;
        }
      }
    });

    socket.on("error", () => {
      reject("Not able to connect to Viz Engine " + host + ":" + port);
    });

    socket.on("end", () => {
      resolve({ raw: treeRaw, scenePath, sceneObjectId });
    });
  });
}

/**
 * Format the tree into a human-readable text representation.
 */
export function formatTreeAsText(tree: VizSceneTree): string {
  const lines: string[] = [];

  lines.push(`Scene: ${tree.scenePath}`);
  lines.push(`Layer: ${tree.layer}`);
  lines.push(`Scene Object ID: ${tree.sceneObjectId}`);
  lines.push(`Fetched: ${new Date(tree.fetchedAt).toISOString()}`);
  lines.push("");

  function formatNode(node: VizContainerNode, indent: number, isGeometry = false): void {
    const pad = "  ".repeat(indent);
    const activeStr = node.active ? "active" : "inactive";
    const visibleStr = node.visible ? "visible" : "hidden";
    const flagStr = node.flags.length > 0 ? ` flags:[${node.flags.join(",")}]` : "";
    const prefix = isGeometry ? "(G) " : "";

    lines.push(`${pad}[${node.treePath}] ${prefix}${node.vizId} ${node.name} (${activeStr}, ${visibleStr}${flagStr})`);

    const pluginTypes = node.plugins
      .filter((p) => p.type !== "FUNCTION")
      .map((p) => p.type);
    if (pluginTypes.length > 0) {
      lines.push(`${pad}    Plugins: ${pluginTypes.join(", ")}`);
    }

    const functions = node.plugins.filter((p) => p.type === "FUNCTION");
    if (functions.length > 0) {
      lines.push(`${pad}    Functions: ${functions.map((f) => f.name || "unnamed").join(", ")}`);
    }

    if (node.geometryVizId) {
      lines.push(`${pad}    Geometry: ${node.geometryVizId}`);
    }

    if (node.imageVizId) {
      lines.push(`${pad}    Image: ${node.imageVizId}`);
    }

    if (node.geometryTree && node.geometryTree.length > 0) {
      lines.push(`${pad}    [Geometry Tree]`);
      for (const geomNode of node.geometryTree) {
        formatNode(geomNode, indent + 2, true);
      }
    }

    for (const child of node.children) {
      formatNode(child, indent + 1, isGeometry);
    }
  }

  for (const rootNode of tree.root) {
    formatNode(rootNode, 0);
  }

  return lines.join("\n");
}

/**
 * Build a lookup of vizId -> full container name path (root to this container).
 * Path is formatted as "Root > Parent > Container".
 */
export function buildContainerPathLookup(
  flatMap: { [vizId: string]: VizContainerNode }
): { [vizId: string]: string } {
  // Build a treePath string -> node lookup
  const pathMap: { [treePath: string]: VizContainerNode } = {};
  for (const node of Object.values(flatMap)) {
    pathMap[node.treePath] = node;
  }

  const result: { [vizId: string]: string } = {};
  for (const node of Object.values(flatMap)) {
    const segments = node.treePath.split("/");
    const names: string[] = [];
    for (let i = 1; i <= segments.length; i++) {
      const partialPath = segments.slice(0, i).join("/");
      const ancestor = pathMap[partialPath];
      if (ancestor) {
        names.push(ancestor.name);
      }
    }
    result[node.vizId] = names.join(" > ");
  }

  return result;
}

/**
 * Write the tree to a text file in the workspace.
 */
export async function writeTreeToFile(tree: VizSceneTree, outputPath: string): Promise<void> {
  const text = formatTreeAsText(tree);
  const uri = Uri.file(outputPath);
  await workspace.fs.writeFile(uri, Buffer.from(text, "utf-8"));
}

/**
 * Save the scene tree to extension storage for caching.
 */
export async function cacheTree(context: ExtensionContext, tree: VizSceneTree): Promise<void> {
  try {
    const serializable = {
      ...tree,
      flatMap: tree.flatMap,
    };
    const content = JSON.stringify(serializable);
    let filePath: Uri;

    if (context.storageUri) {
      filePath = Uri.joinPath(context.storageUri, "vizsceneTree.json");
    } else if (context.globalStorageUri) {
      filePath = Uri.joinPath(context.globalStorageUri, "vizsceneTree.json");
    } else {
      console.warn("No storageUri found for scene tree cache.");
      return;
    }

    await workspace.fs.writeFile(filePath, Buffer.from(content));
  } catch (error) {
    console.error("Failed to cache scene tree:", error);
  }
}

/**
 * Load cached scene tree from extension storage.
 */
export async function getCachedTree(context: ExtensionContext): Promise<VizSceneTree | null> {
  try {
    let filePath: Uri;

    if (context.storageUri) {
      filePath = Uri.joinPath(context.storageUri, "vizsceneTree.json");
    } else if (context.globalStorageUri) {
      filePath = Uri.joinPath(context.globalStorageUri, "vizsceneTree.json");
    } else {
      return null;
    }

    try {
      await workspace.fs.stat(filePath);
    } catch {
      return null;
    }

    const content = await workspace.fs.readFile(filePath);
    return JSON.parse(content.toString()) as VizSceneTree;
  } catch (error) {
    console.error("Failed to load cached scene tree:", error);
    return null;
  }
}

/**
 * Full pipeline: fetch scene tree, parse, build hierarchy,
 * fetch geometry sub-trees, and return a complete VizSceneTree.
 */
export async function getFullSceneTree(
  host: string,
  port: number,
  layer: string,
  fetchGeometry: boolean = true,
): Promise<VizSceneTree> {
  const { raw, scenePath, sceneObjectId } = await fetchSceneTree(host, port, layer);

  const flatNodes = parseTreeResponse(raw);
  const { root, flatMap } = buildTreeHierarchy(flatNodes);

  if (fetchGeometry) {
    await fetchGeometryTrees(host, port, flatMap);
  }

  return {
    scenePath,
    sceneObjectId,
    layer,
    fetchedAt: Date.now(),
    root,
    flatMap,
  };
}
