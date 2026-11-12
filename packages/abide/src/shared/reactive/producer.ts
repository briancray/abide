// THE PRODUCER PORT: every verb a producer OUTSIDE the core spends a value through — the wire and
// the outbox writing what the server produced into a copy (`produceInto`, `patchInto`,
// `refuseInto`), a call ending or timing the load it reached (`loadOf`, `abandonLoad`), the server
// reading what a value serves to stamp, cache and follow it (`servedCellOf`, `deadlineOf`,
// `followServed`). None of them is a member an app can reach; this module is where the framework's
// other seams reach them, rather than the core itself or the app-facing barrel.
//
// What reads only the cell is here; what has to move the graph — a production, a refusal, a
// superseded load — is the core's own, and this module hands it on.
//
// THROUGH THE BARREL FIRST, for the cycle `index.ts` names: a module reaching this port ahead of
// the barrel would enter `Reactive.ts` first, and `scoped.ts` would meet `MEMBER_KEYS` before it is
// initialized. `isReactive` is taken from the barrel, ahead of `Keyed.ts` and `Reactive.ts`, for
// that reason — `cellShape.ts` has no edge into the cycle, so its place does not matter.

import { CELL } from './CELL.ts'
import { type Callable, type Cell, cellOf } from './cellShape.ts'
import { isReactive } from './index.ts'
import { entryDeadline } from './Keyed.ts'
import { holdLog } from './patchLog.ts'
import { ownStream, type Reactive } from './Reactive.ts'

export {
    abandonLoad,
    answeredAtOnce,
    chunksOfStream,
    dropAnswered,
    failedTransiently,
    isAsyncGenerator,
    patchInto,
    produceInto,
    refreshCallerHeld,
    refuseInto,
    standIn,
    streamingOrSettled,
} from './Reactive.ts'

/** Whether `value` holds what was written here, without subscribing — for a caller that is not a reader. */
export function writtenLocally(value: Reactive<unknown>): boolean {
    return cellOf(value).local
}

/**
 * The cell `value` serves from, through every adoption: its identity and its ordinal, and nothing
 * else of it the server can reach.
 *
 * 11.12: an adopting value serves the adopted value's production, and an adoption of an adoption
 * goes on down — so a follow's version (18.7) and its feed name the cell that actually produced.
 */
export function servedCellOf(value: unknown): { readonly ordinal: number } {
    return adoptedCellOf(value)
}

/**
 * Holds a patch log on the cell `value` serves from, with `invalidated` called on its every
 * invalidate; returns what releases both. 18.11, 7.10.
 */
export function followServed(
    value: unknown,
    invalidated: () => void,
): () => void {
    return holdLog(adoptedCellOf(value), invalidated)
}

/**
 * When the production `value` serves stops being servable, as a wall-clock time.
 *
 * 21.8 — WHEN THE PRODUCTION A VALUE IS SERVING STOPS BEING SERVABLE, as a wall-clock time: its
 * own `ttl` from when it was minted (6.5), or its entry's from when the entry last produced
 * (11.45), through whatever it adopts. Infinity where neither bounds it.
 */
export function deadlineOf(value: unknown): number {
    const cell = adoptedCellOf(value)
    if (cell.expiry !== null) return cell.expiry.at + cell.expiry.ms
    return entryDeadline(cell)
}

/**
 * The generation of the load `value` has in flight, or `undefined`.
 *
 * 16.48 — WHICH LOAD A VALUE HAS IN FLIGHT, as the generation that started it, or `undefined` where
 * none is. Read off the cell rather than through `busy`, which is a probe and would subscribe the
 * caller that asked (3.3).
 *
 * A WINDOW HOLDING A PRODUCTION IS BUSY AND IS NO LOAD (5.15): nothing is in flight for a call to end
 * or time, and the window's close is its own bound. Told apart by the hold, which only a value with
 * neither body nor stream makes — so a write's load taken in under a hold is not one a call times.
 */
export function loadOf(value: unknown): number | undefined {
    const cell = cellOf(value)
    if (!cell.loading) return undefined
    if (cell.cap?.holding && cell.stream === null) return undefined
    return cell.generation
}

/**
 * The generation `value`'s past stands at, or `undefined` while a load is in flight.
 *
 * What 21.15's `Cached` compares across a call, read through adoption as `servedCellOf` is.
 */
export function heldGenerationOf(value: unknown): number | undefined {
    const cell = adoptedCellOf(value)
    return cell.loading ? undefined : cell.generation
}

/**
 * Whether `value` is a streaming producer's `Reactive`.
 *
 * A streaming producer's own `Reactive` — a body declared as an async generator, or one whose run
 * handed one back (9.6).
 */
export function isStreaming(value: unknown): boolean {
    if (!isReactive(value)) return false
    const stream = (value as Partial<Callable>)[CELL]?.stream
    return stream !== null && stream !== undefined
}

function adoptedCellOf(value: unknown): Cell {
    let cell = cellOf(value)
    // A stream's own `adoption` is a write it follows (9.11), and its past is its own.
    while (cell.adoption !== null && ownStream(cell) === null)
        cell = cell.adoption.source
    return cell
}
