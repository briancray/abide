import { CURRENT_PATH } from './CURRENT_PATH.ts'

/*
Allocates an await/try block id NAMESPACED by the ambient render-path (ADR-0037). The id is
`${CURRENT_PATH.current}:${n}` where `n` is a per-path counter incremented in document order —
so blocks WITHIN one component/branch/row (one path) number 0,1,2… deterministically, while a
child component (its own path segment) gets its own independent sequence. This replaces the old
flat monotonic counter shared across a component and the children it inlines.

Path-namespacing is what lets sibling child renders run CONCURRENTLY during SSR: their ids no
longer depend on a globally-sequential draw order (which parallel renders would interleave), only
on document order within each child's own path — and the server render-path is ALS-backed
(pathStore), so each child's continuations keep their own path across awaits. The client mounts
each child synchronously under the same path (mountChild → withPath), so both sides compose
byte-identical ids and the resume manifest stays keyed congruently.

`counters` is the per-render-pass map: the request-local `$ctx` threaded through the SSR render
tree, or `RENDER.blockCounters` on the client (see nextBlockId). Concurrent sibling renders write
DIFFERENT path keys, so a shared map needs no locking — each get/set is atomic and per-path.
*/
// @documentation plumbing
export function blockId(counters: Map<string, number>): string {
    const path = CURRENT_PATH.current
    const next = counters.get(path) ?? 0
    counters.set(path, next + 1)
    /* Bare (pathless) render — a top-level page whose route key is `''`, or a component rendered
       outside any route in a test — keeps the plain `0,1,2…` form; only a non-empty path qualifies
       the id. Both sides compute the same path, so the branch is congruent, and the common bare case
       stays identical to the pre-ADR-0037 flat counter. */
    return path === '' ? String(next) : `${path}:${next}`
}
