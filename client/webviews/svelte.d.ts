/// <reference types="svelte" />

declare module "*.svg" {
  const value: any;
  export = value;
}

declare module "*.svelte" {
  const component: any;
  export default component;
}

// Explicit svelte module declaration for TypeScript
declare module "svelte" {
  export function onMount(fn: () => any): void;
  export function onDestroy(fn: () => any): void;
  export function beforeUpdate(fn: () => void): void;
  export function afterUpdate(fn: () => void): void;
  export function tick(): Promise<void>;
  export function untrack<T>(fn: () => T): T;
  export function mount<T>(component: any, options: { target: Element; props?: T }): any;
  export function unmount(component: any): void;
  export type Component<Props = {}, Exports = {}> = any;
}

// Svelte 5 Runes - ambient declarations for TypeScript
declare function $state<T>(initial: T): T;
declare function $state<T>(): T | undefined;
declare function $derived<T>(expression: T): T;
declare function $effect(fn: () => void | (() => void)): void;
declare function $props<T = Record<string, any>>(): T;
declare function $bindable<T>(fallback?: T): T;
declare function $inspect<T>(...values: T[]): { with: (fn: (type: 'init' | 'update', ...values: T[]) => void) => void };
declare function $host<T extends HTMLElement>(): T;
