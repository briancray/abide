// 11.2, 11.4 — A MEMO: a function's value kept per `Args` key, and the one keyed mechanism a handler is
// built on too (16.6). Only `reactive` hands an app a `Reactive`: a memo's entries are
// cells it never hands out, and a call answers the promise of the entry's value — or the stream of its
// chunks — carrying the entry for a derived `reactive` handing it back whole to adopt (16.107).
//
// A FACE OVER THE KEYED VALUE. The entries, their filing per request (11.32), the canonical key
// (11.24), the args gate (11.27), `ttl` (11.45), tags and the pattern triggers are the keyed value's,
// built once by `keyedValue`; this adds the call's answer and the writes an owner of a value has.

import type { CallOptions } from '../rpc.ts'
import type { Schema } from '../Schema.ts'
import { answerOfCall } from './answerOfCall.ts'
import {
    ARGS_GATE,
    canonicalKey,
    type Gated,
    normalized,
    PARAMETER_DEFAULTS,
} from './argsContract.ts'
import type { CALL_ENTRY } from './callAnswer.ts'
import { attendCall } from './callLoad.ts'
import { cellOf } from './cellShape.ts'
import type { Kept, Shaping } from './index.ts'
import type { Keyed } from './Keyed.ts'
import { isStreaming, loadOf, patchInto, produceInto } from './producer.ts'
import type { Reactive, Sourced, Store } from './Reactive.ts'

/**
 * What `memo` takes, and a handler declared over a body (16.110): a value's gates, shaping, identity
 * and key, a source's life, pace, tags and filing, the gate on its args and where each entry is kept.
 * `Accepted` is what `fn` settles to; `Shaped` is read from `transform` alone, the rest naming the
 * value it keeps without inferring it.
 *
 * `schema` IS READ FOR `Gate`, AND `args` FOR `ArgsGate`, only for whether one was given — which is
 * what `Gated` turns into the `ValidationError` a call rejects with (1.3, 15.8). `Args` RAW in `args`,
 * never behind a conditional: a body declaring no annotation reads its `Args` off it (16.87).
 */
export type MemoOptions<
    Args,
    Accepted = unknown,
    Shaped = Accepted,
    Gate = Schema<Accepted>,
    ArgsGate = Schema<Args>,
> = Omit<Shaping<Accepted, Shaped, Gate>, 'store'> &
    Sourced<NoInfer<Args>> & {
        args?: (ArgsGate & Schema<Args>) | undefined
        // 11.78 — where each entry's value is kept, so a restart opens on it rather than running `fn`:
        // one typed by the value, or one inferring nothing, as `store.sqlite(db, 'calls')` does.
        store?: KeptIn<NoInfer<Args>, NoInfer<Kept<Shaped>>> | undefined
    }

/**
 * A store a memo or a handler keeps each entry in, per entry where it is a function of the args.
 *
 * `set` IS A METHOD, SO ITS PARAMETER IS CHECKED BOTH WAYS: a `Store<T>` of the value fits, and so
 * does one inferring nothing (`store.sqlite(db, 'calls')` is a `Store<unknown>`), while a store of
 * another value does not — and an inline `set: (value) => …` still reads `value` as the value. A
 * union of `Store<T>` and `Store<unknown>` would have given that arrow no contextual type.
 */
export type KeptIn<Args, Value> =
    EntryStore<Value> | ((args: Args) => EntryStore<Value>)
type EntryStore<Value> = {
    get: Store<Value>['get'] | Store<unknown>['get']
    set(value: Value, retention: { ttl: number }): void | Promise<void>
    watch?: Store<Value>['watch'] | undefined
}

/** What a call takes: its args, optional where `Args` admits `undefined`. */
export type ArgsTuple<Args> = undefined extends Args
    ? [args?: Args]
    : [args: Args]

/** What a memo's call takes: its args as `ArgsTuple` has them, and who may end its load (16.48). */
export type MemoCallTuple<Args> = undefined extends Args
    ? [args?: Args, options?: Pick<CallOptions, 'signal'>]
    : [args: Args, options?: Pick<CallOptions, 'signal'>]

/**
 * What one call of a `memo` or an `Rpc` answers: the stream of its chunks where it streams —
 * `Produced` is a chunk where `Value` is the chunks — and otherwise the promise of its value, rejected
 * with its refusal (16.3).
 */
export type CallAnswer<Value, Failures, Produced> = ([Value] extends [Produced]
    ? [Produced] extends [Value]
        ? Promise<Value>
        : AsyncIterable<Produced>
    : AsyncIterable<Produced>) & {
    // Typed only: the value and the refusals a derived `reactive` adopting the answer serves as its own
    // (11.12), and what the build reads a handler's value off (19.21).
    readonly [CALL_ENTRY]?:
        | {
              readonly value: Value
              readonly failures: Failures
          }
        | undefined
}

/**
 * A memo: the function's value per `Args` key — answered as a promise, or as the stream of its chunks
 * where the function answers an async iterable — written and followed per key.
 */
export type Memo<
    Value,
    Args = undefined,
    Failures = never,
    Produced = Value,
> = ((
    ...args: MemoCallTuple<Args>
) => CallAnswer<Value, Failures, Produced>) & {
    invalidate(pattern?: Partial<Args>): void
    refresh(pattern?: Partial<Args>): void
    set(...given: Written<Args, Value>): void
    patch(...given: Written<Args, (value: Value) => void>): void
    readable(...args: ArgsTuple<Args>): ReadableStream<Value>
}

/**
 * 11.80 — what an owner's write is handed: `(args, written)`, or `(written)` alone where the value takes
 * no args at all. Where its args are optional a lone argument could be either, so the args are named.
 */
export type Written<Args, What> = [Args] extends [undefined]
    ? [written: What] | [args: Args, written: What]
    : [args: Args, written: What]

/** The keyed value each memo is a face over, which is also what tells a memo from any other function. */
const KEYED = new WeakMap<object, unknown>()

/** Whether `value` is a `memo`'s face (16.117), the arm `rpc` and `reactive` read off it. */
export function isMemo(value: unknown): boolean {
    return typeof value === 'function' && KEYED.has(value)
}

/** 16.6 — the keyed value a memo is a face over, which a handler handed the memo serves. */
export function keyedOf(memo: unknown): unknown {
    return typeof memo === 'function' ? KEYED.get(memo) : undefined
}

/** The memo over `keyed`, whose function streams where `streams` says (9.6). */
export function memoOver<Args, Value>(
    keyed: unknown,
    streams: boolean,
): Memo<Value, Args> & Gated<Args> {
    const face = keyed as Keyed<Value, Args, Value, never> & Gated<Args>
    const entryOf = (args: unknown): Reactive<unknown> =>
        (keyed as (args: unknown) => Reactive<unknown>)(args)
    // 11.2, 11.75 — the promise of the entry's value, or its stream: a cursor of this caller's own
    // over the one run, from its start.
    const call = (
        args?: Args,
        options?: Pick<CallOptions, 'signal'>,
    ): unknown => {
        const signal = options?.signal
        // 16.48 — whether the load this call reaches is one it starts, asked only of a signaled call.
        let before: number | undefined
        let standing: unknown
        if (signal !== undefined) {
            standing = face.entries.get(canonicalKey(normalized(face, args)))
            before = standing === undefined ? undefined : loadOf(standing)
        }
        const entry = entryOf(args)
        const cell = cellOf(entry)
        // A settled entry no call ended has no load to attend: two reads, and nothing filed.
        if (signal !== undefined || cell.loading || cell.failure !== undefined)
            attendCall(
                entry,
                signal,
                entry !== standing ||
                    before === undefined ||
                    loadOf(entry) !== before,
            )
        return answerOfCall(entry, streams || isStreaming(entry), signal)
    }
    const memo = Object.assign(call, ownerWrites(entryOf, false), {
        [ARGS_GATE]: face[ARGS_GATE],
        [PARAMETER_DEFAULTS]: face[PARAMETER_DEFAULTS],
        invalidate: (pattern?: Partial<Args>): void => face.invalidate(pattern),
        refresh: (pattern?: Partial<Args>): void => face.refresh(pattern),
    })
    KEYED.set(memo, keyed)
    return memo as unknown as Memo<Value, Args> & Gated<Args>
}

/**
 * 11.76, 11.77 — AN OWNER'S WRITES AND FOLLOW over the entries `entryOf` reaches: a memo's, and a
 * handler's, which is a memo with an address (16.6) reached past every rung, since the owner is no
 * caller. Each write stands until the next write, `ttl`, `refresh` or `invalidate`.
 *
 * AN OWNER'S WRITE IS A PRODUCTION: the value has no source but its function and its owner, so what
 * the owner writes is what the entry produced (`synced` stays true, 3.11). A browser's `copy` of a
 * handler is the one exception — its value is the wire's, so the write is this page's own, not synced
 * until the server answers (3.10).
 */
export function ownerWrites(
    entryOf: (args: unknown) => Reactive<unknown>,
    copy: boolean,
): {
    set(...given: unknown[]): void
    patch(...given: unknown[]): void
    readable(args?: unknown): ReadableStream<unknown>
} {
    return {
        set: (...given: unknown[]): void => {
            const [args, value] = writeOf(given)
            const entry = entryOf(args)
            if (copy) entry.set(value)
            else produceInto(entry, value)
        },
        patch: (...given: unknown[]): void => {
            const [args, mutate] = writeOf(given)
            const entry = entryOf(args)
            if (copy) entry.patch(mutate as (value: unknown) => void)
            else patchInto(entry, mutate as (value: unknown) => void)
        },
        readable: (args?: unknown): ReadableStream<unknown> =>
            readableOf(entryOf(args)),
    }
}

/**
 * A write's args and what it writes: `(args, written)`, or `(written)` alone for a memo whose args are
 * absent — the one-argument spelling a call without args has (11.76, 11.80).
 */
function writeOf(given: unknown[]): [args: unknown, written: unknown] {
    return given.length === 1 ? [undefined, given[0]] : [given[0], given[1]]
}

/**
 * 11.77 — the entry's value now, then its value after each change, each a copy of its own: a reader
 * keeping one is not handed a value a later patch mutates under it.
 */
function readableOf<Value>(entry: Reactive<Value>): ReadableStream<Value> {
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
