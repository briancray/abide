import type { Component } from 'svelte'

export type Routes = Record<string, () => Promise<{ default: Component }>>
