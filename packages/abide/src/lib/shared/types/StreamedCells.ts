/*
The per-request list of STREAMING async-cell values that SETTLED during this SSR pass, each keyed by
the cell's serialization-stable render-path id (`${scope.id}:${index}`) (ADR-0035). A streaming cell
ships pending in the shell (excluded from the pre-mount `__SSR__.cells` warm-seed, which would
diverge from that pending markup), so instead `createAsyncCell.settleValue` records its resolved
VALUE here when it settles server-side. The page renderer reads this AFTER the shell — streaming an
`__abideResolve({ cellKey, value })` chunk per entry — so the client adopts the server-resolved
value post-hydration (no `loading…` flash) instead of only cold-re-running the seed.

Values (not promises) so the drain never AWAITS — a streaming cell may legitimately stay pending
through the whole request (the `{#if getFoo()}`-holds case), and awaiting it would hang the
response. Only cells that settled before the drain point are streamed; one still pending is simply
not (the client cold-runs it, unchanged). The streaming sibling of `ResolvedCells` (the BLOCKING
warm-seed, read at render-return and stamped into `__SSR__.cells`); this one is read later in the
stream and shipped out-of-order as chunks.
*/
export type StreamedCells = {
    entries: { key: string; value: unknown }[]
}
