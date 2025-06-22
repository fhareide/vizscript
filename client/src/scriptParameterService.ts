/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as net from "net";
import type { ScriptParameter, ScriptParametersData } from "./shared/types";

function GetRegexResult(line: string, regex: RegExp): string[] {
  let result = regex.exec(line);
  return result ? result : ["", "", ""];
}

function parseVizResponse(response: string): string[] {
  // Parse Viz response format like: { "Test" "Test" PUSHBUTTON } { "FormationOffsetX" "Formation Offset X" INT  70 -10000 10000 }
  const blocks: string[] = [];
  let current = "";
  let inBlock = false;
  let braceCount = 0;

  for (let i = 0; i < response.length; i++) {
    const char = response[i];

    if (char === "{") {
      braceCount++;
      if (braceCount === 1) {
        inBlock = true;
        current = "";
        continue;
      }
    } else if (char === "}") {
      braceCount--;
      if (braceCount === 0 && inBlock) {
        blocks.push(current.trim());
        inBlock = false;
        current = "";
        continue;
      }
    }

    if (inBlock) {
      current += char;
    }
  }

  return blocks;
}

function parseParameterDefinition(block: string): ScriptParameter | null {
  // Parse format: "Test" "Test" PUSHBUTTON or "FormationOffsetX" "Formation Offset X" INT  70 -10000 10000
  const parts = block.match(/"([^"]+)"\s+"([^"]+)"\s+(\w+)(?:\s+(\d+)\s+(-?\d+)\s+(-?\d+))?/);

  if (!parts) return null;

  const [, name, displayName, type, defaultVal, min, max] = parts;

  const parameter: ScriptParameter = {
    name,
    displayName,
    type: type as any,
  };

  if (type === "INT" && defaultVal !== undefined) {
    parameter.defaultValue = parseInt(defaultVal);
    parameter.min = min ? parseInt(min) : undefined;
    parameter.max = max ? parseInt(max) : undefined;
  }

  return parameter;
}

function parseCurrentValues(response: string): { [key: string]: any } {
  // Parse format: { - 1 1 }  { 68 1 1 1 }  { 70 1 1 1 }  { 960 1 1 1 }  { 670 1 1 1 }
  const blocks = parseVizResponse(response);
  const values: { [key: string]: any } = {};

  // First block is usually metadata, skip it if it starts with "-"
  let startIndex = 0;
  if (blocks.length > 0 && blocks[0].trim().startsWith("-")) {
    startIndex = 1;
  }

  // Extract values from remaining blocks
  for (let i = startIndex; i < blocks.length; i++) {
    const parts = blocks[i].trim().split(/\s+/);
    if (parts.length > 0) {
      const value = parseInt(parts[0]);
      if (!isNaN(value)) {
        values[`param_${i - startIndex}`] = value;
      }
    }
  }

  return values;
}

export function getScriptParameters(host: string, port: number, scriptId: string): Promise<ScriptParameter[]> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host }, () => {
      socket.write(`1 ${scriptId}*SCRIPT*PLUGIN*PARAMETER GET_WITH_ESCAPED_CHARS${String.fromCharCode(0)}`);
    });

    let receivedData = "";

    socket.on("data", (data) => {
      const message = data.toString();
      const answer = GetRegexResult(message, /^([^\s]+)(\s?)(.*)/gi);

      if (answer[1] === "1") {
        receivedData = answer[3].replace(String.fromCharCode(0), "");
        socket.end();
      }
    });

    socket.on("error", () => {
      reject(`Not able to connect to Viz Engine ${host}:${port}`);
    });

    socket.on("end", () => {
      try {
        const blocks = parseVizResponse(receivedData);
        const parameters: ScriptParameter[] = [];

        for (const block of blocks) {
          const param = parseParameterDefinition(block);
          if (param) {
            parameters.push(param);
          }
        }

        resolve(parameters);
      } catch (error) {
        reject(`Error parsing parameters: ${error.message}`);
      }
    });
  });
}

export function getScriptCurrentValues(host: string, port: number, scriptId: string): Promise<{ [key: string]: any }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host }, () => {
      socket.write(`1 ${scriptId}*SCRIPT*INSTANCE*DATA GET_WITH_ESCAPED_CHARS${String.fromCharCode(0)}`);
    });

    let receivedData = "";

    socket.on("data", (data) => {
      const message = data.toString();
      const answer = GetRegexResult(message, /^([^\s]+)(\s?)(.*)/gi);

      if (answer[1] === "1") {
        receivedData = answer[3].replace(String.fromCharCode(0), "");
        socket.end();
      }
    });

    socket.on("error", () => {
      reject(`Not able to connect to Viz Engine ${host}:${port}`);
    });

    socket.on("end", () => {
      try {
        const values = parseCurrentValues(receivedData);
        resolve(values);
      } catch (error) {
        reject(`Error parsing current values: ${error.message}`);
      }
    });
  });
}

export function setScriptParameterValue(
  host: string,
  port: number,
  scriptId: string,
  parameterName: string,
  value: any,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host }, () => {
      socket.write(`1 ${scriptId}*SCRIPT*INSTANCE*${parameterName} SET ${value}${String.fromCharCode(0)}`);
    });

    socket.on("data", (data) => {
      const message = data.toString();
      const answer = GetRegexResult(message, /^([^\s]+)(\s?)(.*)/gi);

      if (answer[1] === "1") {
        socket.end();
      }
    });

    socket.on("error", () => {
      reject(`Not able to connect to Viz Engine ${host}:${port}`);
    });

    socket.on("end", () => {
      resolve();
    });
  });
}

export function invokeScriptParameter(
  host: string,
  port: number,
  scriptId: string,
  parameterName: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host }, () => {
      socket.write(`1 ${scriptId}*SCRIPT*INSTANCE*${parameterName} INVOKE${String.fromCharCode(0)}`);
    });

    socket.on("data", (data) => {
      const message = data.toString();
      const answer = GetRegexResult(message, /^([^\s]+)(\s?)(.*)/gi);

      if (answer[1] === "1") {
        socket.end();
      }
    });

    socket.on("error", () => {
      reject(`Not able to connect to Viz Engine ${host}:${port}`);
    });

    socket.on("end", () => {
      resolve();
    });
  });
}

export function getScriptParametersData(host: string, port: number, scriptId: string): Promise<ScriptParametersData> {
  return Promise.all([getScriptParameters(host, port, scriptId), getScriptCurrentValues(host, port, scriptId)]).then(
    ([parameters, currentValues]) => {
      // Match current values with parameters
      parameters.forEach((param, index) => {
        param.value = currentValues[`param_${index}`] ?? param.defaultValue;
      });

      return {
        scriptId,
        parameters,
        currentValues,
      };
    },
  );
}
