export type VizScriptObject = {
  name: string;
  type: string;
  extension: string;
  code: string;
  scenePath: string;
  vizId: string;
  children: string[];
  isGroup?: boolean; // Flag to identify if this is a grouped collection
  treePath?: string | string[]; // Path in the scene tree structure
};

export type ScriptParameter = {
  name: string;
  displayName: string;
  type: "INT" | "PUSHBUTTON" | "FLOAT" | "STRING" | "BOOL" | "INFO" | "COLOR";
  value?: any;
  min?: number;
  max?: number;
  defaultValue?: any;
  description?: string;
};

export type ScriptParametersData = {
  scriptId: string;
  parameters: ScriptParameter[];
  currentValues: { [key: string]: any };
};
