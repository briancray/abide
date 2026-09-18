// The server seam — what an app reaches through `abide/server`.
// Request handling, SSR and the rpc boundary. Nothing here may be reached from the client
// entry's static closure.
//
// THE COMPILER IS NOT HERE. It was reserved for `./build` and moved to its own #compiler seam:
// this module is public surface, so a compiler under it is one `export *` from being an app's
// dependency. `packages/abide/tests/compiler.test.ts` holds that apart.

// Re-exported rather than owned: 32.1's escaping is #shared now, because a client swapping a
// `{#if}` branch parses markup too.
export { escapeAttribute, escapeText } from '#shared/escapeText.ts'
export { type Component, render, type Shell } from './render.ts'
