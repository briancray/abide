/* The doc-state warm-seed manifest: an SSR-captured reactive-document snapshot, keyed by its
   scope's serialization-stable render-path id, as a ref-json-encoded STRING (decoded at the read
   site in `createScope`). `startClient` drains `__SSR__.docs` into here before mount; a hydrating
   scope reads its key to seed a plain `state(initial)` to the SERVER value instead of the fresh
   init — a uuid/timestamp/random otherwise diverges from the SSR HTML. Backed by
   `globalThis.__abideDocs` so an inline pre-bundle script and the framework share one store —
   whoever runs first creates it, the other adopts the same reference (mirrors CELL_SEED). */
const globalScope = globalThis as { __abideDocs?: Record<string, string> }
globalScope.__abideDocs ??= {}

export const DOC_SEED: Record<string, string> = globalScope.__abideDocs
