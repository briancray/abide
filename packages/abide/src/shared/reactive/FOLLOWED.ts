// 7.10 — WHAT AN INVALIDATE OF A VALUE THE SERVER FEEDS OVER THE MUX SENDS ON, by the cell its past is
// kept on. The core calls these for every cell it invalidates, however the trigger was spelled — the
// value's own, a `Keyed`'s, an `Rpc`'s or a tag's — and only a value a browser follows has any, so
// every other invalidate is one miss. A leaf, for `PATCH_SINKS`'s reason.
export const FOLLOWED = new WeakMap<object, Set<() => void>>()
