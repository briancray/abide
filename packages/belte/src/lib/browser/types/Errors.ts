import type { Component } from 'svelte'

/*
Manifest of directory prefix → error.svelte module loader. The deepest prefix
that is an ancestor of the failed path wins (nearest-only, like layouts). An
error.svelte renders on the server for an unknown route (404) or a throw during
a page render; the component receives `{ status, message }` props.
*/
export type Errors = Record<string, () => Promise<{ default: Component }>>
