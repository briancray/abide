/*
The per-request list of reactive-document snapshots captured during an SSR render, each keyed by
its scope's serialization-stable render-path id. A rendered scope registers a lazy `take` at
creation; the page renderer calls it at render-return (after the synchronous `state` inits have
run), encodes the non-empty result (ref-json) into `__SSR__.docs`, and the client seeds it so a
plain `state(initial)` — a uuid, a timestamp — hydrates to the SERVER's value instead of
recomputing a divergent one. Sibling of `ResolvedCells` (async-cell values); this holds the
synchronous document state, taken lazily rather than at settle.
*/
export type DocSnapshots = {
    entries: { id: string; take: () => unknown }[]
}
