import * as _vscode from "vscode";
import type { SvelteComponentTyped } from "svelte";

declare module "*.svelte" {
  export default SvelteComponentTyped;
}

declare global {
  const tsvscode: {
    postMessage: ({ type, value }: { type: string; value?: any }) => void;
  };
}
