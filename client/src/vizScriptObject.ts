/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

export class VizScriptObject {
	public name: string = "";
	public type: string = "";
	public extension: string = "";
	public code: string = "";
	public location: string = "";
	public vizId: string = "";
	public children: VizScriptObject[] = [];
}