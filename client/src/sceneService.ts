import * as net from "net";
import { VizScriptObject } from "./shared/types";

/**
 * SceneService handles scene structure validation and scene path operations
 * Simplified for UUID-based system - treePath functionality removed
 */
export class SceneService {
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
   * Helper method for regex matching
   */
  private getRegexResult(line: string, regex: RegExp): string[] {
    const matches = regex.exec(line);
    return matches ? Array.from(matches) : ["", "", "", ""];
  }
}
