/*
The per-request list of async-cell values that RESOLVED during an SSR render, each keyed by the
cell's serialization-stable render-path id (`${scope.id}:${index}`). `createAsyncCell` pushes an
entry when its seed settles server-side; the page renderer stamps them into `__SSR__.cells`
(ref-json-encoded) so the client hydrates the cell WARM — reading the value instead of re-running
the seed (no refetch, no pending flash). The sibling of `PendingAsyncCells` (the barrier's
in-flight list); this one holds settled VALUES, read at render-return rather than awaited.
*/
export type ResolvedCells = {
    entries: { key: string; value: unknown }[]
}
