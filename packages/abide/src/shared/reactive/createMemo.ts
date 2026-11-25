// 11.2, 11.4 — A MEMO: a function's value kept per `Args` key, and the one keyed mechanism a handler is
// built on too (16.6). Only `reactive` and `computed` hand an app a `Reactive`: a memo's entries are
// cells it never hands out, and a call answers the promise of the entry's value — or the stream of its
// chunks — carrying the entry for a `computed` handing it back whole to adopt (16.107).
//
// A FACE OVER THE KEYED VALUE. The entries, their filing per request (11.32), the canonical key
// (11.24), the args gate (11.27), `ttl` (11.45), tags and the pattern triggers are the keyed value's,
// built once by `keyedValue`; this adds the call's answer and the writes an owner of a value has.

import type { Schema } from '../Schema.ts'
import { answerOfCall } from './answerOfCall.ts'
import { ARGS_GATE, type Gated, PARAMETER_DEFAULTS } from './argsContract.ts'
import type { Keyed } from './Keyed.ts'
import { MEMO_BRAND } from './MEMO_BRAND.ts'
import type { Poll } from './poll.ts'
import { isStreaming, patchInto, produceInto } from './producer.ts'
import type { Reactive, Store } from './Reactive.ts'

/** What `memo` takes: how long an entry lives, what selects it, where it is kept, what its args must be, how its elements are told apart, and how often an entry reloads. */
export type MemoOptions<Args> = {
    ttl?: number | undefined
    tags?: string[] | ((args: Args) => string[]) | undefined
    global?: boolean | undefined
    args?: Schema<Args> | undefined
    key?: string | ((element: never) => unknown) | undefined
    poll?: Poll | undefined
    // 11.79 — where each entry's value is kept, so a restart opens on it rather than running `fn`.
    store?: Store<unknown> | ((args: Args) => Store<unknown>) | undefined
}

/**
 * A memo: the function's value per `Args` key — answered as a promise, or as the stream of its chunks
 * where the function answers an async iterable — written and followed per key.
 */
export type Memo<Args, Result, Value = MemoValue<Result>> = ((
    ...args: undefined extends Args ? [args?: Args] : [args: Args]
) => Awaited<Result> extends AsyncIterable<infer Chunk>
    ? AsyncIterable<Chunk>
    : Promise<Awaited<Result>>) & {
    invalidate(pattern?: Partial<Args>): void
    refresh(pattern?: Partial<Args>): void
    set(
        ...given: undefined extends Args
            ? [value: Value] | [args: Args, value: Value]
            : [args: Args, value: Value]
    ): void
    patch(
        ...given: undefined extends Args
            ? | [mutate: (value: Value) => void]
              | [args: Args, mutate: (value: Value) => void]
            : [args: Args, mutate: (value: Value) => void]
    ): void
    readable(
        ...args: undefined extends Args ? [args?: Args] : [args: Args]
    ): ReadableStream<Value>
}

/**
 * A write's args and what it writes: `(args, written)`, or `(written)` alone for a memo whose args are
 * absent — the one-argument spelling a call without args has (11.77).
 */
export function writeOf(given: unknown[]): [args: unknown, written: unknown] {
    return given.length === 1 ? [undefined, given[0]] : [given[0], given[1]]
}

/** What a memo's entry holds: a stream's chunks, else what its function settles to (9.1). */
export type MemoValue<Result> =
    Awaited<Result> extends AsyncIterable<infer Chunk>
        ? Chunk[]
        : Awaited<Result>

/** The member a handler reads the keyed value a memo is a face over through (16.6). */
export const KEYED_OF = Symbol('abide.keyedOf')

/** The memo over `keyed`, whose function streams where `streams` says (9.6). */
export function memoOver<Args, Value>(
    keyed: unknown,
    streams: boolean,
): Memo<Args, unknown, Value> & Gated<Args> {
    const face = keyed as Keyed<Value, Args, Value, never> & Gated<Args>
    const entryOf = (args: Args): Reactive<Value> =>
        (keyed as (args: Args) => Reactive<Value>)(args)
    // 11.2, 11.76 — the promise of the entry's value, or its stream: a cursor of this caller's own
    // over the one run, from its start.
    const call = (...given: [args?: Args]): unknown => {
        const entry = entryOf(given[0] as Args)
        return answerOfCall(entry, streams || isStreaming(entry))
    }
    return Object.assign(call, {
        [MEMO_BRAND]: true,
        [KEYED_OF]: keyed,
        [ARGS_GATE]: face[ARGS_GATE],
        [PARAMETER_DEFAULTS]: face[PARAMETER_DEFAULTS],
        invalidate: (pattern?: Partial<Args>): void => face.invalidate(pattern),
        refresh: (pattern?: Partial<Args>): void => face.refresh(pattern),
        // 11.77 — the owner's writes, standing until the next write, `ttl`, `refresh` or `invalidate`.
        // AN OWNER'S WRITE IS A PRODUCTION: the memo's value has no source but its function and its
        // owner, so what the owner writes is what the entry produced (`synced` stays true, 3.11).
        set: (...given: unknown[]): void => {
            const [args, value] = writeOf(given)
            produceInto(entryOf(args as Args) as Reactive<unknown>, value)
        },
        patch: (...given: unknown[]): void => {
            const [args, mutate] = writeOf(given)
            patchInto(
                entryOf(args as Args) as Reactive<unknown>,
                mutate as (value: unknown) => void,
            )
        },
        readable: (args?: Args): ReadableStream<Value> =>
            readableOf(entryOf(args as Args)),
    }) as unknown as Memo<Args, unknown, Value> & Gated<Args>
}

/**
 * 11.78 — the entry's value now, then its value after each change, each a copy of its own: a reader
 * keeping one is not handed a value a later patch mutates under it.
 */
export function readableOf<Value>(
    entry: Reactive<Value>,
): ReadableStream<Value> {
    let stop: (() => void) | undefined
    return new ReadableStream<Value>({
        start: (controller) => {
            stop = entry.watch((value) => {
                controller.enqueue(structuredClone(value))
            })
        },
        cancel: () => {
            stop?.()
        },
    })
}
