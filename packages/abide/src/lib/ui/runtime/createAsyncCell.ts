import { ASYNC_CELL } from '../../shared/ASYNC_CELL.ts'
import { decodeRefJson } from '../../shared/decodeRefJson.ts'
import { isAsyncIterable } from '../../shared/isAsyncIterable.ts'
import { isThenable } from '../../shared/isThenable.ts'
import { resolvedCellsSlot } from '../../shared/resolvedCellsSlot.ts'
import { streamedCellsSlot } from '../../shared/streamedCellsSlot.ts'
import type { AsyncComputed } from '../../shared/types/AsyncComputed.ts'
import type { AsyncState } from '../../shared/types/AsyncState.ts'
import type { NamedAsyncIterable } from '../../shared/types/NamedAsyncIterable.ts'
import { warmSeedKey } from '../../shared/warmSeedKey.ts'
import { activePendingCells } from '../activePendingCells.ts'
import type { Scope } from '../types/Scope.ts'
import { CELL_SEED } from './CELL_SEED.ts'
import { CURRENT_SCOPE } from './CURRENT_SCOPE.ts'
import { createEffectNode } from './createEffectNode.ts'
import { createSignalNode } from './createSignalNode.ts'
import { readNode } from './readNode.ts'
import { registerStreamedCell } from './STREAMED_CELLS.ts'
import { SuspenseSignal } from './SuspenseSignal.ts'
import { writeNode } from './writeNode.ts'

/* The seed's transform gate (mirrors `state`/`linked`): coerces every value entering
   the store, whether from a settling promise, a frame, or a `set()`. */
type Transform = (next: unknown, previous: unknown) => unknown

type AsyncCellOptions = {
    writable: boolean
    transform?: Transform
    /* ADR-0032: a STREAMING cell must NOT join the SSR blocking barrier. A no-`await` async
       value/content position lowers to a cell that ships pending-`undefined` in the shell and
       resolves on the client, rather than blocking the first flush inline (that is the `await`
       tier). Absent/false → today's blocking registration (`await` tier / a keyed bare read).
       A stream (`isAsyncIterable`) never registers regardless — this only gates a promise seed. */
    streaming?: boolean
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

    /* This cell's serialization-stable warm-seed key: its scope's render-path id + a per-scope
       index, drawn at construction (in declaration order) so SSR and client agree on it. Minted
       through the shared `warmSeedKey` so BOTH sides of the handoff (this same isomorphic call,
       server-side keying `resolvedCells`/`streamedCells` and client-side reading `CELL_SEED`) form
       the identical string from one definition. Undefined for a detached cell (no scope) — such a
       cell never crosses SSR→client, so never warm-seeds. */
    const scope = CURRENT_SCOPE.current as (Scope & { nextCellIndex: () => number }) | undefined
    const warmKey = scope !== undefined ? warmSeedKey(scope.id, scope.nextCellIndex()) : undefined

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
    /* Whether a pending read of this cell PAUSES its reader (ADR-0046). True only for a
       BLOCKING source — a settling PROMISE the cell would join the SSR barrier for (author
       `await`, or a fail-open bare-call that registers): `streaming !== true` AND the seed
       produced a thenable. A STREAM (`isAsyncIterable`) never settles and always peeks, so it
       is NOT blocking even though it carries the same default `streaming` flag; `run` clears
       this when it sees a stream. Resolved from the produced source, not the flag alone, so
       `streaming: false` cannot conflate "author `await`" with "stream". */
    let blockingSource = false

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
        /* Server-only: record the resolved value keyed by this cell's render-path id (the `window`
           guard keeps client settles from ever recording). BLOCKING cells → `resolvedCells`: the
           barrier awaits them before the template peeks, so the value bakes into the SSR HTML and
           the page renderer stamps it into the PRE-mount `__SSR__.cells` warm-seed — a warm client
           value MATCHES it (no flash, no duplication). STREAMING cells → `streamedCells` (ADR-0035):
           they ship pending in the shell, so their value can't ride the pre-mount seed (it would
           diverge from the pending markup); it's streamed AFTER the shell as an `__abideResolve`
           chunk the client adopts POST-hydration. Recording a VALUE (not awaiting a promise) means a
           cell that never settles this request is simply never recorded — no hang. */
        if (warmKey !== undefined && typeof window === 'undefined') {
            if (options.streaming === true) {
                streamedCellsSlot.get()?.entries.push({ key: warmKey, value })
            } else {
                resolvedCellsSlot.get()?.entries.push({ key: warmKey, value })
            }
        }
    }

    /* An error retains the value (SWR): a failed background refresh keeps the stale value
       visible and surfaces the rejection through `error()` — the read decides what to do. */
    const settleError = (myRun: number, error: unknown): void => {
        if (myRun !== runId) {
            return
        }
        inFlight = undefined
        /* A `SuspenseSignal` is a PAUSE, not a failure — the same as the synchronous case in
           `run`, but arriving through a REJECTION: an async seed (`computed(await f(dep))`) reads a
           pending blocking `dep` in its synchronous prefix, and the throw becomes the thunk's
           rejection rather than a sync throw. Stay pending (leave `inFlightNode` true, hold no
           error); the throwing read subscribed this seed's effect to `dep` during that prefix, so
           it re-runs and produces the real source once `dep` settles. */
        if (error instanceof SuspenseSignal) {
            writeNode(errorNode, undefined)
            return
        }
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
        runId += 1
        const myRun = runId
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
            /* A `SuspenseSignal` is a PAUSE, not a failure: this seed read a blocking
               dependency that has no value yet, so this cell's branch pauses too. Stay
               pending — leave `inFlightNode` true, hold no value, carry no error — rather
               than latching the pause into `error()`. The throwing read already subscribed
               this seed's effect to the pending dependency, so when it settles the effect
               re-runs the seed, which now reads a value and produces the real source. No
               promise is registered (there is none), so the SSR barrier's fixpoint drain
               picks this cell up on that re-run instead. */
            if (error instanceof SuspenseSignal) {
                if (myRun === runId) {
                    inFlight = undefined
                    writeNode(errorNode, undefined)
                }
                return
            }
            settleError(myRun, error)
            return
        }

        if (isAsyncIterable(produced)) {
            /* A stream never settles — it PEEKS `undefined` until its first frame, never pauses. */
            blockingSource = false
            consumeStream(myRun, produced as NamedAsyncIterable<unknown>)
            return
        }
        if (isThenable(produced)) {
            /* A settling promise the cell would join the SSR barrier for (author `await`, or a
               fail-open bare-call) PAUSES a pending read; a `streaming` promise peeks. */
            blockingSource = options.streaming !== true
            inFlight = produced as Promise<unknown>
            /* Server-only: register the in-flight promise on the request-scoped pending list so
               the SSR barrier (`$$settleAsyncCells`) awaits it before the template peeks the
               cell — baking the resolved value into the first-pass HTML (ADR-0019 Tier-2). A
               stream (the `isAsyncIterable` branch above) never registers: it never settles. The
               `window` guard keeps client construction from ever registering. A `streaming`
               cell (ADR-0032, a no-`await` position) opts OUT: it ships pending and resolves on
               the client instead of blocking the flush. */
            if (typeof window === 'undefined' && options.streaming !== true) {
                activePendingCells()?.promises.push(inFlight)
            }
            /* `.then(onValue, onError)` handles the rejection inline — contained in `error()`,
               never an unhandled rejection. A STREAMING cell's resolved value is recorded in
               `settleValue` (ADR-0035), not here — awaiting the promise could hang if it never
               settles this request. */
            ;(produced as PromiseLike<unknown>).then(
                (value) => settleValue(myRun, value),
                (error) => settleError(myRun, error),
            )
            return
        }
        settleValue(myRun, produced)
    }

    /* Warm hydrate: if the server shipped this cell's resolved value (keyed by its render-path
       id), adopt it NOW — before the eager run — so `hasValue` is already true. The cell then reads
       as REFRESHING (not pending) through the eager run below, so the value shows instantly with no
       flash and matches the SSR-rendered branch. The run still fires (revalidate + subscribe the
       seed's deps for reactivity, SWR), and its settle supersedes via the `runId` guard. Client-
       only in effect (the store is only ever populated by `startClient`, so it's empty on the
       server — no `window` sniff needed); a decode failure falls through to a cold run. */
    if (warmKey !== undefined) {
        const seeded = CELL_SEED[warmKey]
        if (seeded !== undefined) {
            /* One-shot: consume the seed so a LATER fresh mount at the same render-path can't
               warm-adopt this boot-time snapshot. `scope.id` is the route PATTERN (params-
               independent), so an SPA navigation `/products/42`→`/products/99` — or a back-nav
               that rebuilds the SSR page — recomputes the identical warmKey; without deleting,
               the new cell would render `/products/42`'s stale value until revalidation. The seed
               only ever hydrates the initial SSR render, where each cell is constructed once. */
            delete CELL_SEED[warmKey]
            try {
                acceptValue(decodeRefJson(seeded))
            } catch {
                /* Unserializable/corrupt seed → cold run renders it. */
            }
        }
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

    /* Client-only, STREAMING cells (ADR-0035): a streaming cell ships pending and its value streams
       in AFTER the shell. Register — AFTER the eager run above, so its `inFlight = true` is already
       set — to receive that value by render-path id; when it lands, adopt it as a reactive update:
       the value shows immediately (no `loading…` flash) and the in-flight cold seed run re-settles
       the same value, superseded by the write latch. The streamed value only ever seeds the initial
       render; a later dep-driven reseed is authoritative and runs the seed as usual. */
    if (warmKey !== undefined && options.streaming === true && typeof window !== 'undefined') {
        registerStreamedCell(warmKey, (value) => {
            acceptValue(value)
            writeNode(errorNode, undefined)
            writeNode(inFlightNode, false)
        })
    }

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
        /* Whether a pending read of this cell PAUSES its reader (ADR-0046) — true only for a
           blocking source (a barrier-joining settling promise), resolved from what the seed
           produced (`blockingSource`) so a stream (which shares the default `streaming` flag)
           is correctly NON-blocking. A getter, since the seed's eager run sets it. `readCell`
           consults it; an internal affordance, not on the public cell type. */
        get blocking(): boolean {
            return blockingSource
        },
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
