import { isAsyncCell } from '../../shared/isAsyncCell.ts'
import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'
import { createEffectNode } from '../runtime/createEffectNode.ts'
import { SuspenseSignal } from '../runtime/SuspenseSignal.ts'
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
        if (inFlight !== undefined) {
            /* Await the in-flight settle, then read the freshly-stored value (a `settled` cell
               writes its value before this `.then` runs — it registered its handler first); an
               error there rejects this promise → `{:catch}`. EXCEPT a `SuspenseSignal`
               rejection, which is a PAUSE, not a failure (an async seed's sync prefix read a
               pending blocking dep — the cell swallows it and stays pending, reseeding once the
               dep settles); rejecting would render `{:catch SuspenseSignal}`, so keep waiting
               for the real settle instead. */
            return inFlight.then(
                () => settledValue(cell),
                (error) => {
                    if (error instanceof SuspenseSignal) {
                        return whenSettled(cell)
                    }
                    throw error
                },
            )
        }
        /* Pending with NO in-flight promise — a stream before its first frame, or a
           `SuspenseSignal`-paused seed (both leave `pending()` true with `settled()` cleared).
           Resolving now would read `undefined` into `{:then}` — the exact flash ADR-0047 kills;
           wait for the cell to actually settle. */
        return whenSettled(cell)
    }
    /* Settled: an error with no retained value becomes a REJECTED promise (never a synchronous
       throw), so `awaitBlock`/`renderToStream` route it to `{:catch}` rather than letting it
       escape the block; otherwise the retained value now. `settledValue` is the ONE statement
       of the value-else-error rule for both the settled and the just-settled arms. */
    try {
        return settledValue(cell)
    } catch (error) {
        return Promise.reject(error)
    }
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

/* A promise for the cell's NEXT settle, driven by the graph: an effect watches `pending()` and
   resolves with the settled value (or rejects with its error) the moment it flips false — the
   waiter for the states that hold no in-flight promise to chain on. The write that settles the
   cell flushes effects synchronously (client and SSR alike), so this needs no polling; the
   effect disposes itself on a microtask once done. */
function whenSettled(cell: AsyncComputed<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let done = false
        let dispose: (() => void) | undefined
        const settle = (): void => {
            if (done || cell.pending()) {
                return
            }
            done = true
            try {
                resolve(settledValue(cell))
            } catch (error) {
                reject(error)
            }
            /* Deferred: disposing mid-run would unlink the node while `runNode` is still
               tracking it. */
            queueMicrotask(() => dispose?.())
        }
        dispose = createEffectNode(settle)
    })
}
