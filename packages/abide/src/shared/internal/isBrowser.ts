// The isomorphic side predicate: true in a browser (a `window` global exists), false on the server.
// Computed once at module load — the side never changes within a process. Server-only concepts
// (AsyncLocalStorage scope, shared cross-request cache) gate on `!isBrowser`; the client falls back
// to its own per-instance behaviour.
//
// Its sibling `hasDom` asks a DIFFERENT question (is there a `document`?), and under `bun test` the two
// deliberately disagree — see that file for which gate wants which, and why.
export const isBrowser =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { window?: unknown }).window !== 'undefined'
