import * as net from "net";
import { VizScriptObject } from "./shared/types";

export interface VizTreeNode {
  treePath: string; // e.g., "1/1/1/1"
  vizId: string; // current session vizId
  name: string; // container name
  type: "Scene" | "Container";
}

export interface TreeStructure {
  [layer: string]: VizTreeNode[]; // layer -> array of tree nodes
}

/**
 * Service for handling Viz tree operations and tree path resolution
 */
export class TreeService {
  /**
   * Gets the complete tree structure for all layers
   */
  async getTreeStructure(
    host: string,
    port: number,
    layers: string[] = ["MAIN_SCENE", "FRONT", "MID", "BACK"],
  ): Promise<TreeStructure> {
    const treeStructure: TreeStructure = {};

    for (const layer of layers) {
      try {
        const nodes = await this.getTreeForLayer(host, port, layer);
        treeStructure[layer] = nodes;
      } catch (error) {
        console.warn(`Failed to get tree for layer ${layer}:`, error);
        treeStructure[layer] = [];
      }
    }

    return treeStructure;
  }

  /**
   * Gets tree structure for a specific layer
   */
  private getTreeForLayer(host: string, port: number, layer: string): Promise<VizTreeNode[]> {
    return new Promise((resolve, reject) => {
      const nodes: VizTreeNode[] = [];

      const socket = net.createConnection({ port, host }, () => {
        socket.write(`1 ${layer}*TREE*DATA GET` + String.fromCharCode(0));
      });

      socket.on("data", (data) => {
        const message = data.toString().replace(String.fromCharCode(0), "");
        const answer = this.getRegexResult(message, /^([^\s]+)(\s?)(.*)/gi);

        if (answer[1] === "1") {
          if (answer[3].startsWith("ERROR")) {
            console.log(`No tree data found for ${layer}`);
            socket.end();
            resolve([]);
            return;
          }

          // Parse tree data: <{1 143257 A 1} {1/1 143264 B 1} {1/1/1 143271 C 1} {1/1/1/1 142752 Container}>
          const treeData = answer[3];
          nodes.push(...this.parseTreeData(treeData, layer));
          socket.end();
        }
      });

      socket.on("error", (error) => {
        reject(`Not able to connect to Viz Engine ${host}:${port} - ${error.message}`);
      });

      socket.on("end", () => {
        resolve(nodes);
      });
    });
  }

  /**
   * Parses tree data string into VizTreeNode array
   */
  private parseTreeData(treeData: string, layer: string): VizTreeNode[] {
    const nodes: VizTreeNode[] = [];

    // Match patterns like {1/1/1/1 142752 Container}
    const regex = /\{([^\s]+)\s+(\d+)\s+([^}]+)\}/g;
    let match;

    while ((match = regex.exec(treeData)) !== null) {
      const treePath = match[1];
      const vizId = `#${match[2]}`;
      const nameAndType = match[3].trim();

      // Determine type and name
      let type: "Scene" | "Container";
      let name: string;

      if (treePath === "1") {
        type = "Scene";
        name = nameAndType;
      } else {
        type = "Container";
        name = nameAndType === "Container" ? `Container_${treePath.replace(/\//g, "_")}` : nameAndType;
      }

      nodes.push({
        treePath,
        vizId,
        name,
        type,
      });
    }

    return nodes;
  }

  /**
   * Resolves current vizIds from tree paths using current tree structure
   */
  async resolveVizIdsFromTreePaths(
    scriptObjects: VizScriptObject[],
    host: string,
    port: number,
    layer: string = "MAIN_SCENE",
  ): Promise<VizScriptObject[]> {
    try {
      const treeNodes = await this.getTreeForLayer(host, port, layer);
      const treePathMap = new Map<string, string>(); // treePath -> vizId

      // Build map of tree paths to current vizIds
      for (const node of treeNodes) {
        treePathMap.set(node.treePath, node.vizId);
      }

      // Update script objects with current vizIds based on tree paths
      return scriptObjects.map((script) => {
        if (script.isGroup && Array.isArray(script.treePath)) {
          // For groups, update children based on their tree paths
          const updatedChildren: string[] = [];
          for (const treePath of script.treePath) {
            const vizId = treePathMap.get(treePath);
            if (vizId) {
              updatedChildren.push(vizId);
            }
          }
          return {
            ...script,
            children: updatedChildren.length > 0 ? updatedChildren : script.children,
          };
        } else if (
          script.type === "Container" &&
          typeof script.treePath === "string" &&
          script.treePath &&
          treePathMap.has(script.treePath)
        ) {
          // For individual container scripts
          return {
            ...script,
            vizId: treePathMap.get(script.treePath)!,
          };
        }
        return script;
      });
    } catch (error) {
      console.error("Error resolving vizIds from tree paths:", error);
      return scriptObjects; // Return unchanged if resolution fails
    }
  }

  /**
   * Finds tree path for a given vizId in the current tree structure
   */
  async findTreePathForVizId(
    vizId: string,
    host: string,
    port: number,
    layer: string = "MAIN_SCENE",
  ): Promise<string | null> {
    try {
      const treeNodes = await this.getTreeForLayer(host, port, layer);
      const node = treeNodes.find((n) => n.vizId === vizId);
      return node ? node.treePath : null;
    } catch (error) {
      console.error("Error finding tree path for vizId:", error);
      return null;
    }
  }

  /**
   * Validates that a script's scene path matches the current scene
   */
  async validateScenePath(
    expectedScenePath: string,
    host: string,
    port: number,
    layer: string = "MAIN_SCENE",
  ): Promise<{ isValid: boolean; currentScenePath?: string; error?: string }> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port, host }, () => {
        socket.write(`1 ${layer}*UUID GET` + String.fromCharCode(0));
      });

      socket.on("data", async (data) => {
        const message = data.toString().replace(String.fromCharCode(0), "");
        const answer = this.getRegexResult(message, /^([^\s]+)(\s?)(.*)/gi);

        if (answer[1] === "1") {
          if (answer[3].startsWith("ERROR")) {
            resolve({ isValid: false, error: `No scene found in ${layer}` });
            socket.end();
            return;
          }

          // Get scene path from UUID
          socket.write("PATH FILENAME_FROM_UUID GET " + answer[3] + String.fromCharCode(0));
        } else if (answer[1] === "PATH") {
          if (answer[3].startsWith("ERROR")) {
            resolve({ isValid: false, error: `No scene path found for UUID` });
            socket.end();
            return;
          }

          const currentScenePath = answer[3];
          const isValid = currentScenePath === expectedScenePath;

          resolve({
            isValid,
            currentScenePath,
            error: isValid
              ? undefined
              : `Scene path mismatch. Expected: ${expectedScenePath}, Current: ${currentScenePath}`,
          });

          socket.end();
        }
      });

      socket.on("error", (error) => {
        resolve({
          isValid: false,
          error: `Connection error: ${error.message}`,
        });
      });
    });
  }

  /**
   * Updates script objects with tree paths from current tree structure
   */
  async enrichScriptObjectsWithTreePaths(
    scriptObjects: VizScriptObject[],
    host: string,
    port: number,
    layer: string = "MAIN_SCENE",
  ): Promise<VizScriptObject[]> {
    try {
      const treeNodes = await this.getTreeForLayer(host, port, layer);
      const vizIdToTreePathMap = new Map<string, string>(); // vizId -> treePath

      // Build map of vizIds to tree paths
      for (const node of treeNodes) {
        vizIdToTreePathMap.set(node.vizId, node.treePath);
      }

      // Update script objects with tree paths
      return scriptObjects.map((script) => {
        if (script.isGroup && script.children.length > 0) {
          // For groups, collect all tree paths from children
          const treePaths: string[] = [];
          for (const childVizId of script.children) {
            const treePath = vizIdToTreePathMap.get(childVizId);
            if (treePath) {
              treePaths.push(treePath);
            }
          }
          return {
            ...script,
            treePath: treePaths.length > 0 ? treePaths : script.treePath || [],
          };
        } else if (script.type === "Container") {
          // For individual containers
          const treePath = vizIdToTreePathMap.get(script.vizId);
          return {
            ...script,
            treePath: treePath || script.treePath || "", // Keep existing treePath if not found
          };
        }
        // Scene scripts don't need treePath
        return script;
      });
    } catch (error) {
      console.error("Error enriching script objects with tree paths:", error);
      return scriptObjects; // Return unchanged if enrichment fails
    }
  }

  /**
   * Helper method for regex matching
   */
  private getRegexResult(line: string, regex: RegExp): string[] {
    const matches = regex.exec(line);
    return matches ? Array.from(matches) : ["", "", "", ""];
  }
}
