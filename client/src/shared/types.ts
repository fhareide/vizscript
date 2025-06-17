export type VizScriptObject = {
  name: string;
  type: string;
  extension: string;
  code: string;
  scenePath: string;
  vizId: string;
  children: string[];
  isGroup?: boolean; // Flag to identify if this is a grouped collection
};
