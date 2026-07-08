import { ASYNC_CELL } from '../../shared/ASYNC_CELL.ts'
import { isAsyncIterable } from '../../shared/isAsyncIterable.ts'
import { isThenable } from '../../shared/isThenable.ts'
import { pendingAsyncCellsSlot } from '../../shared/pendingAsyncCellsSlot.ts'
import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'
import type { AsyncState } from '../../shared/types/AsyncState.ts'
import type { NamedAsyncIterable } from '../../shared/types/NamedAsyncIterable.ts'
import { createEffectNode } from './createEffectNode.ts'
import { createSignalNode } from './createSignalNode.ts'
import { readNode } from './readNode.ts'
import { writeNode } from './writeNode.ts'

/* The seed's transform gate (mirrors `state`/`linked`): coerces every value entering
   the store, whether from a settling promise, a frame, or a `set()`. */
type Transform = (next: unknown, previous: unknown) => unknown

type AsyncCellOptions = {
    writable: boolean
    transform?: Transform
}

/*
The source-agnostic async cell — the runtime behind `computed`/`linked` when the seed
tracks a promise or a NamedAsyncIterable (ADR-0019 D1). It is **eager**: a reactive
effect runs the seed once at construction (capturing its synchronous dependencies) and
re-runs — a *reseed* — whenever they change, so independent cells load in parallel and a
dependent cell re-loads when its dependency settles. The seed's result drives the cell:

  - a **promise** (an `async () => await …` thunk) → unwrap; resolve → value, reject → error;
  - a **NamedAsyncIterable** (socket / streaming rpc) → `for await` its frames, each frame
    updating the value; the terminal error/close land on `error()` / clear in-flight;
  - a **synchronous value** (a seed that produced one directly) → settle immediately.

Read through the probe family only — there is no `.value`. `pending()` is "no value yet",
`refreshing()` is "a held value while a fresher source is in flight" (a reseed or a
`refresh()`), `peek()` is the retained value/latest frame (stale-while-revalidate),
`error()` the last rejection. Every out-of-order settle is guarded by a run id, so a slow
prior flight never overwrites a newer one. `refresh()` re-invokes the seed keeping the
value visible; a writable cell adds `set()`, which latches until the next reseed.
*/
export function createAsyncCell(
    seed: () => unknown,
    options: AsyncCellOptions,
): AsyncComputed<unknown> | AsyncState<unknown> {
    const transform = options.transform
    /* Reactive state, each its own signal so a reader subscribes only to the facets it
       touches (peeking the value does not re-run on a pending flip, and vice versa). */
    const valueNode = createSignalNode(undefined)
    const errorNode = createSignalNode(undefined)
    const inFlightNode = createSignalNode(true)
    const hasValueNode = createSignalNode(false)

    /* `linked` write latch: a local `set()` holds the cell until the next reseed, so an
       arriving frame / settling promise never clobbers an in-progress edit. Cleared on reseed. */
    let written = false
    /* Supersedes out-of-order settles: only the latest run's promise/stream may write. */
    let runId = 0
    /* The current run's in-flight promise (undefined once settled, or for a stream/sync seed).
       Surfaced through `settled()` for the SSR barrier's structural read; a stream never sets it. */
    let inFlight: Promise<unknown> | undefined
    /* Cancels the active stream subscription (a reseed, refresh, or dispose supersedes it). */
    let cancelStream: (() => void) | undefined

    /* Store a produced value, honouring the write latch and the transform gate. */
    const acceptValue = (value: unknown): void => {
        if (written) {
            return
        }
        writeNode(valueNode, transform === undefined ? value : transform(value, valueNode.value))
        writeNode(hasValueNode, true)
    }

    const settleValue = (myRun: number, value: unknown): void => {
        if (myRun !== runId) {
            return
        }
        inFlight = undefined
        acceptValue(value)
        writeNode(errorNode, undefined)
        writeNode(inFlightNode, false)
    }

    /* An error retains the value (SWR): a failed background refresh keeps the stale value
       visible and surfaces the rejection through `error()` — the read decides what to do. */
    const settleError = (myRun: number, error: unknown): void => {
        if (myRun !== runId) {
            return
        }
        inFlight = undefined
        writeNode(errorNode, error)
        writeNode(inFlightNode, false)
    }

    /* Drive a NamedAsyncIterable: first frame clears pending, each later frame updates the
       value (unless written), a throw lands in `error()`, and completion clears in-flight. */
    const consumeStream = (myRun: number, source: NamedAsyncIterable<unknown>): void => {
        const iterator = source[Symbol.asyncIterator]()
        let live = true
        cancelStream = (): void => {
            live = false
            void iterator.return?.(undefined)
        }
        const pump = async (): Promise<void> => {
            try {
                while (live && myRun === runId) {
                    const step = await iterator.next()
                    if (!live || myRun !== runId) {
                        return
                    }
                    if (step.done === true) {
                        writeNode(inFlightNode, false)
                        return
                    }
                    acceptValue(step.value)
                    writeNode(errorNode, undefined)
                    writeNode(inFlightNode, false)
                }
            } catch (error) {
                settleError(myRun, error)
            }
        }
        /* The pump never rejects (its body is fully try/caught), so the kickoff is contained
           — no unhandled rejection, never Bun-fatal. */
        void pump()
    }

    /* Run (or re-run) the seed. `reseed` marks a dependency-driven new source, which clears
       the write latch; a `refresh()` passes false so a held write and value survive. */
    const run = (reseed: boolean): void => {
        const myRun = (runId += 1)
        if (cancelStream !== undefined) {
            cancelStream()
            cancelStream = undefined
        }
        if (reseed) {
            written = false
        }
        writeNode(inFlightNode, true)

        let produced: unknown
        try {
            produced = seed()
        } catch (error) {
            settleError(myRun, error)
            return
        }

        if (isAsyncIterable(produced)) {
            consumeStream(myRun, produced as NamedAsyncIterable<unknown>)
            return
        }
        if (isThenable(produced)) {
            inFlight = produced as Promise<unknown>
            /* Server-only: register the in-flight promise on the request-scoped pending list so
               the SSR barrier (`$$settleAsyncCells`) awaits it before the template peeks the
               cell — baking the resolved value into the first-pass HTML (ADR-0019 Tier-2). A
               stream (the `isAsyncIterable` branch above) never registers: it never settles. The
               `window` guard keeps client construction from ever registering. */
            if (typeof window === 'undefined') {
                pendingAsyncCellsSlot.get()?.promises.push(inFlight)
            }
            /* `.then(onValue, onError)` handles the rejection inline — contained in `error()`,
               never an unhandled rejection. */
            ;(produced as PromiseLike<unknown>).then(
                (value) => settleValue(myRun, value),
                (error) => settleError(myRun, error),
            )
            return
        }
        settleValue(myRun, produced)
    }

    /* The eager first-run + reactive reseed: the effect tracks the seed's synchronous reads,
       so a dependency change re-runs it. Its cleanup cancels any live stream on reseed/dispose. */
    createEffectNode(() => {
        run(true)
        return (): void => {
            if (cancelStream !== undefined) {
                cancelStream()
                cancelStream = undefined
            }
        }
    })

    /* The shared read surface, identical for read-only and writable cells. */
    const readOnly: AsyncComputed<unknown> = {
        [ASYNC_CELL]: true,
        peek: () => readNode(valueNode),
        /* No value yet: in flight and nothing retained. */
        pending: () => readNode(inFlightNode) === true && readNode(hasValueNode) !== true,
        /* A held value being superseded: in flight but a value is retained. */
        refreshing: () => readNode(inFlightNode) === true && readNode(hasValueNode) === true,
        error: () => readNode(errorNode),
        /* Re-invoke the seed keeping the value visible (SWR); not a reseed, so a write holds. */
        refresh: () => run(false),
        /* The current in-flight promise (undefined once settled / not-a-promise) — an internal
           runtime affordance the SSR barrier reads structurally; not on the public cell types. */
        settled: () => inFlight,
    } as AsyncComputed<unknown>
    if (!options.writable) {
        return readOnly
    }
    /* A writable cell adds `set()`: latches until the next reseed. `settled` rides along from
       the `readOnly` spread (a runtime affordance not on the public type). */
    const writable: AsyncState<unknown> = {
        ...readOnly,
        set: (value: unknown): void => {
            written = true
            writeNode(
                valueNode,
                transform === undefined ? value : transform(value, valueNode.value),
            )
            writeNode(hasValueNode, true)
        },
    }
    return writable
}
