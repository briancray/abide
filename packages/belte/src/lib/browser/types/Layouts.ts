import type { Component } from 'svelte'

/*
Manifest of directory prefix → layout.svelte module loader. The deepest
prefix that is an ancestor of a route wins (no stacking).
*/
export type Layouts = Record<string, () => Promise<{ default: Component }>>
