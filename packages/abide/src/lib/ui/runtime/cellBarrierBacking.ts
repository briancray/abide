import type { PendingAsyncCells } from '../../shared/types/PendingAsyncCells.ts'

/*
The swappable backing for the PER-RENDER async-cell barrier override (ADR-0037 Phase 2). Mirrors
`ambientPathBacking`: the default is an inert passthrough (no override — the barrier list resolves
through the per-request `pendingAsyncCellsSlot` as before), and the server installs an
AsyncLocalStorage-backed variant (`renderCellBarrierStore`) so a hoisted child render can run its
async cells under its OWN list.

Why a per-render override at all: sibling child renders that run CONCURRENTLY (the parallel-SSR
hoist) each register cells on the request-scoped pending list, and `settleAsyncCells` drains it with
`splice(0)` — so one child's barrier would drain a sibling's cells, letting that sibling's template
peek a still-pending value. Running each hoisted child under `isolateCellBarrier` gives it a fresh
list (via `run`), so `activePendingCells()` returns that list for the child's registrations and its
own barrier drain — isolated from every concurrent sibling and from the page. `current()` returns
`undefined` outside any isolated render, so the page's own cells fall through to the request list
unchanged. Kept out of `node:async_hooks` on the client: the default backing is pure JS, and the ALS
variant is installed only server-side.
*/
export const cellBarrierBacking: {
    active: {
        current: () => PendingAsyncCells | undefined
        run: <T>(list: PendingAsyncCells, render: () => T) => T
    }
} = {
    active: {
        current: () => undefined,
        run: (_list, render) => render(),
    },
}
