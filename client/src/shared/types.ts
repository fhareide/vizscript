export type VizScriptObject = {
  name: string;
  type: string;
  extension: string;
  code: string;
  scenePath: string;
  vizId: string;
  children: string[];
  isGroup?: boolean; // Flag to identify if this is a grouped collection
  isGroupChild?: boolean; // Flag to identify if this is an individual child of a group
  treePath?: string | string[]; // Path in the scene tree structure
};

export type ScriptParameterType =
  | "INT"
  | "FLOAT"
  | "DOUBLE"
  | "SLIDERINT"
  | "SLIDERDOUBLE"
  | "STRING"
  | "TEXT"
  | "BOOL"
  | "COLOR"
  | "CONTAINER"
  | "IMAGE"
  | "DROPDOWN"
  | "LIST"
  | "HLIST"
  | "LABEL"
  | "PUSHBUTTON"
  | "RADIOBUTTON"
  | "INFO"
  | "DIR"
  | "FILE";

export type ScriptParameter = {
  name: string;
  displayName: string;
  type: ScriptParameterType;
  value?: any;
  min?: number;
  max?: number;
  defaultValue?: any;
  description?: string;
  entries?: string[];
  separator?: string;
  maxLength?: number;
  filter?: string;
  defaultPath?: string;
};

export type ScriptParametersData = {
  scriptId: string;
  parameters: ScriptParameter[];
  currentValues: { [key: string]: any };
};
