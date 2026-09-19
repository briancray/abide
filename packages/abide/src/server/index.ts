// The server seam — what an app reaches through `abide/server`.
// Request handling, SSR and the rpc boundary. Nothing here may be reached from the client
// entry's static closure.
//
// THE COMPILER IS NOT HERE. It was reserved for `./build` and moved to its own #compiler seam:
// this module is public surface, so a compiler under it is one `export *` from being an app's
// dependency. `packages/abide/tests/compiler.test.ts` holds that apart.

// Re-exported rather than owned: 32.1's escaping is #shared now, because a client swapping a
// `{#if}` branch parses markup too.
export {
    escapeAttribute,
    escapeStyleValue,
    escapeText,
} from '#shared/escapeText.ts'
// 32.3's run-time half. `raw` is an APP's name rather than the compiler's, so it crosses here
// the way the escaping does: `{raw(x)}` lowers to this export and an author importing `raw`
// reaches the same one.
export { Raw, raw } from '#shared/Raw.ts'
// 32.22's run-time half, re-exported for the same reason: an interpolated `href` is checked
// where its value arrives, and both sides render markup.
export { safeUrl } from '#shared/safeUrl.ts'
// 31.9's run-time half, re-exported for the same reason: a write through a member path copies
// down that path wherever the write happens, and a `<script>` runs on both sides.
export { writePath } from '#shared/writePath.ts'
// 32.16 and 32.24's run-time half: what a `{#for}` subject iterates as, asked by the server's emitted
// block and by the client's `updateList` through the one function, so the two cannot disagree.
export { listOf } from '#shared/listOf.ts'
export { type Component, render, type Shell } from './render.ts'
