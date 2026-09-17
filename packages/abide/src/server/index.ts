// The server seam — what an app reaches through `abide/server`.
// Request handling, SSR and the rpc boundary. Nothing here may be reached from the client
// entry's static closure.
//
// THE COMPILER IS NOT HERE. It was reserved for `./build` and moved to its own #compiler seam:
// this module is public surface, so a compiler under it is one `export *` from being an app's
// dependency. `packages/abide/tests/compiler.test.ts` holds that apart.

export { escapeText } from './escapeText.ts'
export { type Component, render, type Shell } from './render.ts'
