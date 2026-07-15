import { activePendingCells } from './activePendingCells.ts'

/*
The SSR await-barrier the compiler lowers to `$$settleAsyncCells()` between a
component's cell declarations and its template (ADR-0019 Tier-2). It DRAINS the
request-scoped pending list (`splice(0)`) so each barrier awaits only the cells
declared since the last one — `renderChain` renders layout layers sequentially,
each with its own barrier, and a drain keeps a later layer from re-awaiting an
earlier settled layer's cells. `Promise.allSettled` never rejects the render: a
rejected cell settles into its `error()` state, surfaced at the read site (via
`$$readCell`), not here. On the client the list is always empty (cells register
server-side only), so the barrier is a no-op await.

It drains to a FIXPOINT — "await until this branch of the graph stops pausing" —
not a single snapshot. Pending propagates down dependency edges: a blocking cell
whose seed reads a still-pending blocking dependency stays pending and registers no
promise (its seed threw a `SuspenseSignal`, caught as pending, not error). When the
dependency settles inside this await, the reactive flush is synchronous, so the
dependent's seed re-runs and registers ITS promise before the loop re-checks — the
whole chain resolves in order. The per-render list isolation (`isolateCellBarrier`)
keeps the loop draining only this render's cascade, never a concurrent sibling's.
*/
// @documentation plumbing
export async function settleAsyncCells(): Promise<void> {
    const pending = activePendingCells()
    if (pending === undefined) {
        return
    }
    while (pending.promises.length > 0) {
        await Promise.allSettled(pending.promises.splice(0))
    }
}
