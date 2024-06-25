import * as _vscode from "vscode";
import type { SvelteComponent } from "svelte";

/// <reference types="svelte" />

declare module "*.svg" {
  const value: any;
  export = value;
}
declare module "*.svelte" {
  export default SvelteComponent;
}

declare global {
  const tsvscode: {
    postMessage: ({ type, value }: { type: string; value?: any }) => void;
    getState: () => any;
    setState: (newState: any) => void;
  };
}
