/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

export type VizScriptObject = {
  name: string;
  type: string;
  extension: string;
  code: string;
  location: string;
  vizId: string;
  children: VizScriptObject[];
};
