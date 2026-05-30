import type { Component } from 'svelte'

/*
Manifest of route URL → page.svelte module loader. Produced by the resolver
plugin from `page.svelte` files anywhere under src/browser/pages.
*/
export type Pages = Record<string, () => Promise<{ default: Component }>>
