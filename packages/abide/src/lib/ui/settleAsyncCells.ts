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
*/
// @documentation plumbing
export async function settleAsyncCells(): Promise<void> {
    const pending = activePendingCells()
    if (pending === undefined) {
        return
    }
    const promises = pending.promises.splice(0)
    if (promises.length > 0) {
        await Promise.allSettled(promises)
    }
}
