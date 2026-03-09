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

export type VizPluginRef = {
  type: string;
  name?: string;
  vizId: string;
};

export type VizContainerNode = {
  treePath: string;
  vizId: string;
  name: string;
  flags: number[];
  active: boolean;
  visible: boolean;
  plugins: VizPluginRef[];
  geometryVizId?: string;
  imageVizId?: string;
  children: VizContainerNode[];
  geometryTree?: VizContainerNode[];
};

export type VizSceneTree = {
  scenePath: string;
  sceneObjectId: string;
  layer: string;
  fetchedAt: number;
  root: VizContainerNode[];
  flatMap: { [vizId: string]: VizContainerNode };
};
