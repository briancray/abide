import { isAsyncCell } from '../../shared/isAsyncCell.ts'
import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'
import { readCell } from './readCell.ts'

/*
The subject of an `{#await X}` block, normalised so the block AWAITS an async cell's
resolution instead of peeking its `undefined`-while-pending value (ADR-0047). `{#await}`
means "wait", so when its subject is a `computed`/`linked` async cell the block should show
its pending branch until the cell settles, then `{:then}` with the resolved value — but a
cell reference otherwise lowers to `$$readCell(cell)`, a PEEK, which reads `undefined` while
pending and fires `{:then}` with `undefined` (the `{#if}`/`{#switch}` cell subjects avoid this
with a `cellPending` guard; `{#await}` had no equivalent).

The compiler wraps ONLY a bare cell-reference subject in this (a plain-promise subject like
`{#await getFoo()}` bypasses it), so `subject` is always some cell the `cellReadNames` set
named — of two runtime shapes:

  - **an async cell** (`AsyncComputed`/`AsyncState` — a `computed`/`linked` whose seed unwraps a
    promise/stream). Pending (in flight, no value) → a PROMISE resolving to the cell's value once
    it settles (rejecting with its error); the `pending()` read subscribes the reading block, so a
    client reseed/`cache.invalidate` re-runs it and the SSR `renderToStream` awaits the returned
    promise. Settled (a value, or a held value being refreshed — SWR) → the value now, so `{:then}`
    shows it with no pending flash; an error with no retained value throws (→ `{:catch}`/`{#try}`).
  - **a lazy `Computed`/`State`/derive** holding a bare promise (`computed(getFoo())` with no
    `await` stays an opaque promise-holder, not an async cell) → read through `readCell` to its
    `.value`, i.e. the promise itself, which `awaitBlock`/`renderToStream` then awaits — exactly the
    pre-existing `{#await computedPromise}` behaviour, preserved.
*/
// @documentation plumbing
export function awaitSubject(subject: unknown): unknown {
    if (!isAsyncCell(subject)) {
        /* A lazy `Computed`/`State`/derive reference: unwrap to its `.value` (the held promise or
           value), which the await block awaits — never peeked to `undefined`. */
        return readCell(subject)
    }
    const cell = subject as AsyncComputed<unknown> & {
        settled?: () => Promise<unknown> | undefined
    }
    /* `pending()` — in flight AND no value — is the only state that WAITS; a settled or
       refreshing cell reads its retained value now (SWR). The read subscribes the caller. */
    if (cell.pending()) {
        const inFlight = cell.settled?.()
        /* Await the in-flight settle, then read the freshly-stored value (a `settled` cell
           writes its value before this `.then` runs — it registered its handler first); a throw
           there rejects this promise → `{:catch}`. A cell reported pending with no in-flight
           promise resolves on the next tick. */
        return (inFlight ?? Promise.resolve()).then(() => settledValue(cell))
    }
    /* Settled: an error with no retained value becomes a REJECTED promise (never a synchronous
       throw), so `awaitBlock`/`renderToStream` route it to `{:catch}` rather than letting it
       escape the block; otherwise the retained value now. */
    const error = cell.error()
    const value = cell.peek()
    if (value === undefined && error !== undefined) {
        return Promise.reject(error)
    }
    return value
}

/* The value of an in-flight cell once it settles: its retained value, or a throw when it holds
   only an error — the throw rejects the awaiting promise, routing to `{:catch}`/`{#try}`. */
function settledValue(cell: AsyncComputed<unknown>): unknown {
    const value = cell.peek()
    if (value === undefined) {
        const error = cell.error()
        if (error !== undefined) {
            throw error
        }
    }
    return value
}
