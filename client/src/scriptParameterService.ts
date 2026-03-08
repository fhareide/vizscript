/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import * as net from "net";
import type { ScriptParameter, ScriptParameterType, ScriptParametersData } from "./shared/types";

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

function tokenizeBlock(block: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < block.length) {
    if (block[i] === '"') {
      const end = block.indexOf('"', i + 1);
      if (end === -1) break;
      tokens.push(block.substring(i + 1, end));
      i = end + 1;
    } else if (/\s/.test(block[i])) {
      i++;
    } else {
      let end = i;
      while (end < block.length && !/\s/.test(block[end]) && block[end] !== '"') end++;
      tokens.push(block.substring(i, end));
      i = end;
    }
  }
  return tokens;
}

function parseParameterDefinition(block: string): ScriptParameter | null {
  const tokens = tokenizeBlock(block);
  if (tokens.length < 3) return null;

  const knownTypes: ScriptParameterType[] = [
    "INT", "FLOAT", "DOUBLE", "SLIDERINT", "SLIDERDOUBLE",
    "STRING", "TEXT", "BOOL", "COLOR", "CONTAINER", "IMAGE",
    "DROPDOWN", "LIST", "HLIST", "LABEL", "PUSHBUTTON", "RADIOBUTTON", "INFO",
  ];

  const name = tokens[0];
  let displayName: string;
  let type: ScriptParameterType;
  let rest: string[];

  // Viz always sends "name" "displayName" TYPE ... (3-token format).
  // However, if there are only 2 tokens and the second is a known type,
  // treat it as a no-label parameter.
  if (tokens.length >= 3 && knownTypes.includes(tokens[2].toUpperCase() as ScriptParameterType)) {
    displayName = tokens[1];
    type = tokens[2].toUpperCase() as ScriptParameterType;
    rest = tokens.slice(3);
  } else if (knownTypes.includes(tokens[1].toUpperCase() as ScriptParameterType)) {
    displayName = name;
    type = tokens[1].toUpperCase() as ScriptParameterType;
    rest = tokens.slice(2);
  } else {
    return null;
  }

  const parameter: ScriptParameter = { name, displayName, type };

  switch (type) {
    case "INT":
    case "SLIDERINT": {
      if (rest.length >= 1) parameter.defaultValue = parseInt(rest[0]);
      if (rest.length >= 2) parameter.min = parseInt(rest[1]);
      if (rest.length >= 3) parameter.max = parseInt(rest[2]);
      break;
    }
    case "FLOAT":
    case "DOUBLE":
    case "SLIDERDOUBLE": {
      if (rest.length >= 1) parameter.defaultValue = parseFloat(rest[0]);
      if (rest.length >= 2) parameter.min = parseFloat(rest[1]);
      if (rest.length >= 3) parameter.max = parseFloat(rest[2]);
      break;
    }
    case "BOOL": {
      if (rest.length >= 1) {
        parameter.defaultValue = rest[0] === "1" || rest[0].toLowerCase() === "true";
      }
      break;
    }
    case "STRING": {
      if (rest.length >= 1) parameter.defaultValue = rest[0];
      if (rest.length >= 3) parameter.maxLength = parseInt(rest[2]);
      break;
    }
    case "TEXT": {
      if (rest.length >= 1) parameter.defaultValue = rest[0];
      break;
    }
    case "COLOR": {
      if (rest.length >= 1) parameter.defaultValue = rest[0];
      break;
    }
    case "DROPDOWN":
    case "LIST": {
      if (rest.length >= 1) parameter.defaultValue = parseInt(rest[0]);
      const entries: string[] = [];
      let idx = 1;
      while (idx < rest.length && isNaN(Number(rest[idx]))) {
        entries.push(rest[idx]);
        idx++;
      }
      if (entries.length > 0) parameter.entries = entries;
      break;
    }
    case "HLIST": {
      if (rest.length >= 1) parameter.defaultValue = parseInt(rest[0]);
      const hEntries: string[] = [];
      let hIdx = 1;
      while (hIdx < rest.length && isNaN(Number(rest[hIdx]))) {
        hEntries.push(rest[hIdx]);
        hIdx++;
      }
      if (hEntries.length > 0) parameter.entries = hEntries;
      if (hIdx < rest.length) parameter.separator = rest[hIdx];
      break;
    }
    case "RADIOBUTTON": {
      if (rest.length >= 1) parameter.defaultValue = parseInt(rest[0]);
      const btnNames = rest.slice(1);
      if (btnNames.length > 0) parameter.entries = btnNames;
      break;
    }
    case "PUSHBUTTON": {
      if (rest.length >= 1) parameter.defaultValue = parseInt(rest[0]);
      break;
    }
  }

  return parameter;
}

function parseCurrentValues(response: string): { [key: string]: any } {
  const blocks = parseVizResponse(response);
  const values: { [key: string]: any } = {};

  let startIndex = 0;
  if (blocks.length > 0 && blocks[0].trim().startsWith("-")) {
    startIndex = 1;
  }

  for (let i = startIndex; i < blocks.length; i++) {
    const tokens = tokenizeBlock(blocks[i]);
    if (tokens.length > 0) {
      values[`param_${i - startIndex}`] = tokens[0];
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
      const answer = GetRegexResult(message, /^([^\s]+)(\s?)([\s\S]*)/gi);

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
      const answer = GetRegexResult(message, /^([^\s]+)(\s?)([\s\S]*)/gi);

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
