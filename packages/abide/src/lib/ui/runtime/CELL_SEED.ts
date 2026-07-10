/* The async-cell warm-seed manifest: an SSR-resolved cell value, keyed by the cell's
   serialization-stable render-path id (`${scope.id}:${index}`), as a ref-json-encoded STRING
   (decoded lazily at the read site in `createAsyncCell`, so an in-process graph with cycles /
   shared back-references survives where JSON would drop it — the same codec `RESUME` uses).
   `startClient` drains `__SSR__.cells` into here before mount; a hydrating cell reads its key to
   seed its value warm instead of re-running the seed (no refetch, no pending flash).

   Backed by `globalThis.__abideCells` so an inline pre-bundle script and the framework share one
   store — whoever runs first creates it, the other adopts the same reference (mirrors RESUME). */
const globalScope = globalThis as { __abideCells?: Record<string, string> }
globalScope.__abideCells ??= {}

// @documentation plumbing
export const CELL_SEED: Record<string, string> = globalScope.__abideCells
