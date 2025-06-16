export type VizScriptObject = {
  name: string;
  type: string;
  extension: string;
  code: string;
  scenePath: string;
  vizId: string;
  treePath?: string | string[]; // Stable tree path - string for individual scripts, array for groups
  children: string[];
  isGroup?: boolean; // Flag to identify if this is a grouped collection
};
