// THE FACTORIES, and the barrel they are the address of. `reactive` holds what the scope owns and
// `memo` runs a body (11.1, 11.2): two names for two contracts — what a write means differs between
// them — over one `Reactive` type, whose reads, probes and triggers are the same on both.
//
// SPLIT BY NAME, NOT BY WHAT IS PASSED. One name read its first argument's type to pick a form, and
// that made a function unholdable: `reactive(fn)` ran it. Now `reactive(fn)` holds `fn` (4.20), and
// `memo` is handed a body or throws (11.74).
//
// The factory lives in the folder's address rather than in a file of its own: `reactive`
// and `Reactive` differ only in case, and a case-insensitive filesystem makes those one
// file (TS1149). An address is the one name CLAUDE.md's file-naming rule exempts.

import type { Failed } from '../Failed.ts'
import type { Issues } from '../Issues.ts'
import { OUTBOX_SENDING } from '../OUTBOX_SENDING.ts'
import type { Annotated, Rpc } from '../rpc.ts'
import { RPC_SERVER } from '../RPC_SERVER.ts'
import type { Schema } from '../Schema.ts'
import type { CALL_ENTRY } from './CALL_ENTRY.ts'
import { createMemo, type Memo, type MemoOptions } from './createMemo.ts'
import { DECLARED_TAGS } from './DECLARED_TAGS.ts'
import { isReactive } from './isReactive.ts'
import { createKeyed, isKeyed, type Keyed } from './Keyed.ts'
import { MEMO_BRAND } from './MEMO_BRAND.ts'
import { NO_INITIAL } from './NO_INITIAL.ts'
import { declaresParameter } from './parameterDefaults.ts'
import {
    busyOver,
    createReactive,
    invalidateOver,
    type Reactive,
    type ReactiveOptions,
    readyOver,
    refreshOver,
    syncedOver,
} from './Reactive.ts'
import { outsideScope, scoped } from './scoped.ts'
import { SCOPING } from './scoping.ts'
import { share } from './share.ts'

export { isReactive } from './isReactive.ts'
export { type Memo, type MemoOptions } from './createMemo.ts'
export { isKeyed, type Keyed } from './Keyed.ts'
export { NotLanded } from './NotLanded.ts'
export { abortSignal } from './poll.ts'
// The rest of the framework reaches the core through here rather than `./Reactive.ts`: `Reactive.ts` →
// `log.ts` → this barrel → `scoped.ts` → `Reactive.ts` is a cycle, and a module loaded first that
// imports the core directly meets `MEMBER_KEYS` before it is initialized. The verbs a producer
// outside the core spends a value through are `producer.ts`'s, which comes through here first.
export {
    flushSync,
    type Identity,
    moveItem,
    type Reactive,
    type ReactiveOptions,
    rowItem,
    type Store,
    type Transformer,
} from './Reactive.ts'
export { STREAMING } from './STREAMING.ts'
export {
    currentShare,
    enterShare,
    leaveShare,
    resumeShare,
    type Shared,
} from './share.ts'
export { deepEqual } from './deepEqual.ts'
export { type Disposer, type Effect, watch } from './watch.ts'

/**
 * What a static probe or trigger may be asked about: a value, a keyed face, or `{ tags }`.
 *
 * Both result types already carry the four members, and a `Keyed` already applies the right
 * quantifier over its entries — ANY for `busy`, ALL for `ready` — so the selection is the shape
 * rather than a union, and the statics have no arm to pick.
 *
 * 13.1'S LAST ARM IS `{ tags }`: every value carrying any of those tags, across values.
 */
export type Selection =
    | {
          busy(): boolean
          ready(): boolean
          synced(): boolean
          refresh(): void
          invalidate(): void
      }
    | { tags: string[] }

/**
 * What a selection sweeps: the tags it names, `null` where it names nothing, or `undefined` where it
 * names one value, whose own members answer.
 *
 * NOTHING NAMED IS EVERY LOAD IN REACH: each value in this scope, and each `global` one, whose
 * producer is a store or has started a load (13.6, 13.8, 13.10) — see `fileProducer`.
 */
function sweepOf(
    selection: Selection | undefined,
): string[] | null | undefined {
    if (selection === undefined) return null
    return typeof selection === 'object'
        ? (selection as { tags: string[] }).tags
        : undefined
}

type Refusal = Failed<string, unknown>
/**
 * What a `transform` hands back that is kept: its return minus any refusal.
 *
 * WHAT A `transform` HANDS BACK, SPLIT BY WHAT IT IS. A refusal is told apart structurally at run
 * time (15.6), and the types split the return the same way: one parameter, `Shaped`, is inferred
 * from the whole return and the stored value and the failures are read off it. Two parameters —
 * `Stored | Failures` — cannot be inferred from one union: the checker put all of it in `Stored`,
 * so a refusing transform stored its own refusal and `s.error()` lost the name it refused with.
 */
export type Kept<Shaped> = Exclude<Shaped, Refusal>
/** What a `transform` hands back that is a refusal — the counterpart of `Kept`. */
export type Refused<Shaped> = Extract<Shaped, Refusal>
// `transform` ALONE IS WHERE `Shaped` IS READ FROM. The rest of the options mention the stored value
// too — a `store`, an `identity` — and inferring from those as well made a `store` whose `get` is
// typed `never` pin the stored value to `never`.
//
// `schema` IS READ FOR `Gate` THE SAME WAY, and only for whether one was given: the intersection
// leaves `Accepted` inferred from `Schema<Accepted>` exactly as before, and `Gate` stays `never`
// at its default where no schema is passed — which is what `Gated` turns into the refusal 1.3 adds.
// `args` is read for `ArgsGate` the same way: its refusal is a `ValidationError` too (15.8).
export type Shaping<
    Accepted,
    Shaped,
    Args = never,
    Gate = Schema<Accepted>,
    ArgsGate = Schema<Args>,
> = Omit<
    ReactiveOptions<Accepted, Kept<NoInfer<Shaped>>, never, Args>,
    'transform' | 'schema' | 'args'
> & {
    transform?: ((value: Accepted) => Shaped) | undefined
    schema?: (Gate & Schema<Accepted>) | undefined
    args?:
        ([Args] extends [never] ? never : ArgsGate & Schema<Args>) | undefined
}
/**
 * The validation refusal a declared `schema` adds to `Failures`, and `never` where none is.
 *
 * 1.3: CARRIED WITHOUT THE APP DECLARING IT. A schema that refuses fills `s.error` with a
 * `ValidationError` (15.8) whose `data` is the `Issues` of what it was handed, so the type is read
 * off the gate's presence rather than written beside it — `s.error()` typed `never` over a gated
 * value made `s.error()?.data` a compile error that worked at run time.
 *
 * `Gate` DEFAULTS TO `Schema<Accepted>`, the one type no schema an app writes is: a function or a
 * Standard Schema is one arm of that union, never both. The default is what a call with no
 * `schema` infers, and what every call with explicit type arguments gets — `never` there would
 * make `schema` itself unspellable, so those calls keep the gate and lose only this refusal's type.
 */
export type Gated<Gate, Accepted> = [Schema<Accepted>] extends [Gate]
    ? never
    : Failed<'ValidationError', Issues<Accepted>>
/** What a built value refuses with: its `transform`'s refusals, and each gate's that was declared. */
export type Refusals<
    Shaped,
    Gate,
    Stored,
    ArgsGate = Schema<never>,
    Args = never,
> = Refused<Shaped> | Gated<Gate, Stored> | Gated<ArgsGate, Args>
/** The failures a body handing back a `Reactive` adopts from it (11.12). */
export type AdoptedFailures<Computed> =
    Computed extends Reactive<unknown, never, infer Failures, unknown>
        ? Failures
        : Computed extends {
                readonly [CALL_ENTRY]?:
                    { readonly failures: infer Failures } | undefined
            }
          ? Failures
          : never
/** The chunks a body adopts from a streaming `Reactive` it hands back, else `Otherwise` (11.12). */
export type AdoptedProduced<Computed, Otherwise> =
    Computed extends Reactive<unknown, never, unknown, infer Produced>
        ? Produced
        : Otherwise

/**
 * The `Reactive` one call of an `Rpc` is written into (4.19), for each `Rpc` in `Calls` — a union of
 * them where `Calls` is a union, which `reactive` folds into one value: the call's value, and the
 * refusals its promise rejects with as its failures (16.8).
 */
export type CallOf<Calls> =
    Calls extends Rpc<infer Value, infer Args, infer Failures, infer Produced>
        ? Reactive<
              Value,
              Value,
              Failures | Failed<'HttpError', undefined> | Annotated<Args>,
              Produced
          >
        : never
/** What a `Reactive` in `Calls` stores — the union over `Calls`, distributed. */
type StoredOf<Calls> =
    Calls extends Reactive<infer Stored, never, unknown, unknown>
        ? Stored
        : never
/**
 * What `reactive` holds: anything but a `Reactive` or a `Keyed`, which it adopts rather than holds
 * (11.61) — a plain function included (4.20). The promise turns a `Reactive` away too, being one
 * (1.4), and `Accepted` read through it is the value it settles to. NOT DISTRIBUTED:
 * `Held<number | undefined>` spread over the union is `PromiseLike<number> | PromiseLike<undefined>`,
 * and a `Promise<number | undefined>` is neither.
 */
export type Held<Accepted> = [Accepted] extends [{ invalidate: unknown }]
    ? never
    : Accepted | (PromiseLike<Accepted> & { invalidate?: never | undefined })
/**
 * What a body's value is, read off what it returns: the chunks an async iterable yields where it
 * streams (9.6), else what it settles to. A `Reactive` handed back is unwrapped by `Awaited` first,
 * being thenable (1.4), so its own `Symbol.asyncIterator` never reads as a stream here.
 */
export type BodyValue<Result> = ChunksOrValue<Awaited<Result>>
// Distributed, so a body answering a stream on one arm and a value on the other — `asked ?
// summarize() : []` — is either's value rather than neither's.
type ChunksOrValue<Answer> =
    Answer extends AsyncIterable<infer Chunk> ? Chunk[] : Answer
/** What a body streams, chunk by chunk, or what it adopts from a `Reactive` it hands back (11.12). */
export type BodyProduced<Result, Otherwise> =
    Awaited<Result> extends AsyncIterable<infer Chunk>
        ? Chunk
        : AdoptedProduced<Result, Otherwise>
/** What `memo` builds from a body: a `Keyed` where it takes `Args`, a `Reactive` where it takes none. */
export type ReactiveOf<Args, Result, Shaped, Gate, ArgsGate> = [Args] extends [
    never,
]
    ? Reactive<
          Kept<Shaped>,
          BodyValue<Result>,
          AdoptedFailures<Result> | Refusals<Shaped, Gate, BodyValue<Result>>,
          BodyProduced<Result, Kept<Shaped>>
      >
    : Keyed<
          Kept<Shaped>,
          Args,
          BodyValue<Result>,
          | AdoptedFailures<Result>
          | Refusals<Shaped, Gate, BodyValue<Result>, ArgsGate, Args>,
          BodyProduced<Result, Kept<Shaped>>
      >

/**
 * A value the scope owns outright, opening at `initial`, or at what a promise of it settles to.
 *
 * REQUIRED: against an optional parameter the checker infers `Accepted` with `undefined` taken out,
 * so `reactive(maybe)` was a value that refused the `undefined` it opened with (4.15).
 */
export function reactive<Accepted, Shaped = Accepted, Gate = Schema<Accepted>>(
    // `undefined` WHATEVER `Accepted` IS: `reactive<User>(undefined)` opens a `User` at `undefined`
    // (4.15). Inside a conditional on `Accepted`, so inference never sees a bare `undefined` to match
    // an argument's against and take out of `Accepted` — which `NoInfer<undefined>` did not stop.
    initial:
        Held<Accepted> | ([Accepted] extends [unknown] ? undefined : never),
    options?: Shaping<Accepted, Shaped, never, Gate>,
): Reactive<Kept<Shaped>, Accepted, Refusals<Shaped, Gate, Accepted>>
/**
 * A value nothing has written yet: `reactive<User>()`, not ready until the first `set` (2.9).
 *
 * 4.19 — `reactive<typeof save>()` IS THE VALUE A CALL OF `save` IS, so the value a call is written to
 * carries its value and its failures, as `Issues<typeof save>` reads its args (19.26). The test
 * distributes INSIDE the tuple, so it holds where every member of a union is an `Rpc`, and the tuple
 * keeps the answer one value — undistributed, `reactive<User | undefined>()` was typed as two. One
 * `Rpc` inferred from a union of them matched neither, and typed `reactive<typeof a | typeof b>()`
 * as a value holding a handler.
 */
export function reactive<Accepted>(): [
    Accepted extends Rpc<
        infer _Value,
        infer _Args,
        infer _Failures,
        infer _Produced
    >
        ? true
        : false,
] extends [true]
    ? Reactive<
          StoredOf<CallOf<Accepted>>,
          StoredOf<CallOf<Accepted>>,
          AdoptedFailures<CallOf<Accepted>>,
          AdoptedProduced<CallOf<Accepted>, StoredOf<CallOf<Accepted>>>
      >
    : Reactive<Kept<Accepted>, Accepted, Refused<Accepted>>
export function reactive(
    // A REST TUPLE rather than two parameters, so the count of what was passed is read: 4.14 has no
    // argument land nothing where 4.15 has `undefined` land `undefined`.
    //
    // `unknown` RATHER THAN A `ReactiveOptions`, and it is the overloads that force it: a
    // spelling concrete enough to pass straight through is one the overloads are not all
    // assignable to, once `Failures` carries a bound. The implementation signature is the bridge
    // nothing calls directly, so the casts below are where the overloads' promises are made good.
    ...given: [first?: unknown, options?: unknown]
): unknown {
    return filed(given, false, buildValue)
}

/**
 * A value `body` produces, run again when a value it read changes (11.1), and a stream where it hands
 * back an async iterable (9.6).
 *
 * `Value` IS READ ONLY THROUGH `Result`'s DEFAULT: `computed<number[]>(() => …)` names the value the
 * body produces, and with explicit type arguments the rest take their defaults. Inferred, it is
 * never read.
 *
 * 19.24 — `Result` IS READ OFF THE BODY ALONE, hence `NoInfer` in the options: the checker infers
 * through `Awaited`, so a `Schema<{ id: number }>` beside an async body put `{ id: number }` in it
 * and the body's promise no longer fit.
 */
export function computed<
    Value = never,
    Result = Value,
    Shaped = BodyValue<Result>,
    Gate = Schema<BodyValue<Result>>,
>(
    body: () => Result,
    options?: Shaping<BodyValue<NoInfer<Result>>, Shaped, never, Gate>,
): ReactiveOf<never, Result, Shaped, Gate, never>
export function computed(body: unknown, options?: unknown): unknown {
    refuseValue(body, 'computed')
    return filed([body, options], false, buildBody)
}

/**
 * `fn`, remembered: what it answers for each `Args` key is kept and handed back as it answered — a
 * value, a promise, a refusal — to every later call with those args (11.2, 11.4). A `computed`
 * calling it holds the answer as a value, and runs again when the key it called is refreshed or
 * invalidated (11.75).
 *
 * NO PARAMETER IS SNIFFED: a function declaring none is kept on `undefined`, called as `m()`.
 */
export function memo<Args = undefined, Result = unknown>(
    fn: (args: Args) => Result,
    options?: MemoOptions<Args>,
): Memo<Args, Result>
export function memo(fn: unknown, options?: unknown): unknown {
    refuseValue(fn, 'memo')
    return filed([fn, options], true, buildMemo)
}

/**
 * The keyed form an `Rpc` and the wire's copies are built on: one `Reactive` per `Args` key. Not app
 * surface — only `reactive` and `computed` hand an app a `Reactive`.
 */
export function keyedValue<
    Value = never,
    Args = undefined,
    Result = Value,
    Shaped = BodyValue<Result>,
    Gate = Schema<BodyValue<Result>>,
    ArgsGate = Schema<Args>,
>(
    body: (args: Args) => Result,
    options?: Shaping<BodyValue<NoInfer<Result>>, Shaped, Args, Gate, ArgsGate>,
): Keyed<
    Kept<Shaped>,
    Args,
    BodyValue<Result>,
    | AdoptedFailures<Result>
    | Refusals<Shaped, Gate, BodyValue<Result>, ArgsGate, Args>,
    BodyProduced<Result, Kept<Shaped>>
>
export function keyedValue(body: unknown, options?: unknown): unknown {
    return filed([body, options], true, buildBody)
}

function buildMemo(given: [first?: unknown, options?: unknown]): unknown {
    return createMemo(
        'memo',
        given[0] as (args: unknown) => unknown,
        given[1] as MemoOptions<unknown> | undefined,
    )
}

// 11.74 — at construction, the earliest moment there is: a value handed where a body belongs would
// otherwise be read as one by every later call.
function refuseValue(body: unknown, name: string): void {
    if (
        typeof body !== 'function' ||
        isReactive(body) ||
        isKeyed(body) ||
        (body as { [MEMO_BRAND]?: true | undefined })[MEMO_BRAND] === true
    )
        throw new TypeError(
            `abide: ${name} takes a body, a function it runs. A value to hold is reactive(value). RULEBOOK 11.74.`,
        )
}

/**
 * Builds the value `given` names, filed where it lives.
 *
 * 11.32 — ON A SERVER, OUTSIDE A REQUEST, THE VALUE IS FILED: a forwarder to one instance per
 * request, and to the one built here where there is no request at all — or, for a value with a
 * `store`, built where it is first reached (11.71). `global` is what keeps a value process-wide
 * (11.34).
 */
function filed(
    given: [first?: unknown, options?: unknown],
    keyed: boolean,
    build: (
        given: [first?: unknown, options?: unknown],
        keyed: boolean,
    ) => unknown,
): unknown {
    const options = given[1] as
        | {
              global?: boolean | undefined
              store?: unknown
              tags?: string[] | undefined
          }
        | undefined
    let built: unknown
    if (outsideScope(options?.global === true)) {
        const lazy = !keyed && options?.store !== undefined
        built = scoped(() => build(given, keyed), lazy)
        // 41.34 — a declaration's, told to the server, which keeps it where its home has a load in
        // flight. Not an `ambient`'s: abide builds those where they are first reached, in a browser too.
        if (!keyed && !lazy) SCOPING.provider?.filed(built)
    } else built = build(given, keyed)
    // 13.15 — for a `GET` handed this value to read its followers' tags off.
    if (options?.tags !== undefined)
        DECLARED_TAGS.set(built as object, options.tags)
    return built
}

/**
 * `reactive` and `computed` for a framework ambient — `route`, `online` — filed per scope whatever the
 * load order.
 *
 * A factory decides at construction, and a value abide itself builds at import can be built before
 * the server has installed its provider, which made it one value for every request in the process.
 * A forwarder resolves to its home wherever no scope is current, so in a browser this is the one
 * value it always was, behind one more call.
 */
export const ambient = ((...given: [first?: unknown, options?: unknown]) =>
    scoped(() => buildValue(given))) as unknown as typeof reactive
export const ambientComputed = ((body: unknown, options?: unknown) =>
    scoped(() =>
        buildBody([body, options], false),
    )) as unknown as typeof computed

/**
 * `memo` over a handler's plain function, or `reactive` over its value, for `declare` — or the
 * `Reactive` itself, where it is one already.
 *
 * 16.5 — THE ARM IS READ OFF A BRAND. A `Keyed` and a one-parameter plain function have the same
 * shape, and only the first has already decided its own keying.
 *
 * 16.64 — a body declaring no parameter is not started where the handler is declared: outside a
 * request its value is built by the first call rather than by the import — and where it declares
 * `global`, built once for every request rather than once per request (11.34).
 */
export function handlerValue(body: unknown, options: unknown): unknown {
    if (isReactive(body) || isKeyed(body)) return body
    if (typeof body !== 'function') return reactive(body, options as undefined)
    const given: [unknown, unknown] = [body, options]
    const keyed = isKeyedBody(body)
    if (!keyed && outsideScope(false))
        return scoped(
            () => buildBody(given, keyed),
            true,
            (options as { global?: boolean | undefined } | undefined)
                ?.global === true,
        )
    return keyedValue(body as (args: unknown) => unknown, options as undefined)
}

// The two body forms are told apart by WHETHER A PARAMETER IS DECLARED, which is the author saying
// this value is keyed. Not by `length`, which counts neither a defaulted parameter nor a rest one.
function isKeyedBody(first: unknown): boolean {
    return (
        typeof first === 'function' &&
        !isReactive(first) &&
        declaresParameter(first as (...given: never[]) => unknown)
    )
}

// `keyed` is `isKeyedBody(first)`, decided once by the caller: a filed value is built again per
// request from the same function, and the answer reads its source text.
function buildBody(
    given: [first?: unknown, options?: unknown],
    keyed: boolean,
): unknown {
    const [first, options] = given
    const body = first as (args?: unknown) => unknown
    if (keyed)
        return createKeyed(
            'memo',
            body,
            (options ?? undefined) as Parameters<typeof createKeyed>[2],
        )
    return createReactive(
        'computed',
        body as (args: unknown) => unknown,
        undefined,
        undefined,
        options as Parameters<typeof createReactive>[4],
    )
}

function buildValue(given: [first?: unknown, options?: unknown]): unknown {
    return createReactive(
        'reactive',
        null,
        undefined,
        // 4.14 AGAINST 4.15: called with no argument is empty, and called with `undefined` is loaded.
        given.length === 0 ? NO_INITIAL : given[0],
        given[1] as Parameters<typeof createReactive>[4],
    )
}

// What a pattern beside a selection is typed as: the `Args` the selection's OWN member narrows by
// (13.12), read off the member being called rather than off `refresh` for all four — the four take
// the same two arguments, and deriving three of them from a fourth is one member's signature
// standing in for another's. A `Reactive`'s members take none, so a pattern there is inert; the
// tag arm takes none at all.
type PatternOf<
    Chosen,
    Member extends 'busy' | 'ready' | 'synced' | 'refresh' | 'invalidate',
> =
    Chosen extends Record<Member, (pattern?: infer Pattern) => unknown>
        ? Pattern
        : never

/**
 * Whether any entry in the selection has work in flight — ANY, against `ready`'s ALL.
 *
 * THE FREE PROBES AND TRIGGERS. 3.2 keeps a probe from starting work beyond what a read would run, and 1.7 has reaching an
 * instance start it, so the allocate/do-not-allocate split is visible in the spelling rather than
 * remembered as a rule. A pattern is handed to the selection's own face, which is what narrows a
 * `Keyed` and an `Rpc` over one — so `refresh(s, pattern)` and `s.refresh(pattern)` are one call
 * (13.4, 13.12).
 */
export function busy<Chosen extends Selection>(
    selection?: Chosen,
    pattern?: PatternOf<Chosen, 'busy'>,
): boolean {
    const sweep = sweepOf(selection)
    // 46.11 — a bare `busy` hears a call the outbox is sending, which no value holds.
    if (sweep === null)
        return busyOver(sweep) || OUTBOX_SENDING.any?.() === true
    if (sweep !== undefined) return busyOver(sweep)
    return (selection as { busy(pattern: unknown): boolean }).busy(pattern)
}
/**
 * Whether every entry in the selection has a value to serve — ALL, against `busy`'s ANY.
 *
 * The ambiguity stood declared rather than resolved for a long time; these are the quantifiers
 * under which `busy && !ready` reads as one sentence.
 */
export function ready<Chosen extends Selection>(
    selection?: Chosen,
    pattern?: PatternOf<Chosen, 'ready'>,
): boolean {
    const sweep = sweepOf(selection)
    if (sweep !== undefined) return readyOver(sweep)
    return (selection as { ready(pattern: unknown): boolean }).ready(pattern)
}
/**
 * Whether every entry in the selection holds what its producer made — ALL, as `ready` asks (13.18).
 */
export function synced<Chosen extends Selection>(
    selection?: Chosen,
    pattern?: PatternOf<Chosen, 'synced'>,
): boolean {
    const sweep = sweepOf(selection)
    if (sweep !== undefined) return syncedOver(sweep)
    return (selection as { synced(pattern: unknown): boolean }).synced(pattern)
}
/**
 * Stale-while-revalidate over the selection: reloads it while serving what it holds.
 *
 * 13.15 — ON A SERVER A SWEEP REACHES THE COPIES BROWSERS FOLLOW TOO, bare or by tag: a handler built
 * per request holds no value here for the sweep to find, and its copies are the point.
 */
export function refresh<Chosen extends Selection>(
    selection?: Chosen,
    pattern?: PatternOf<Chosen, 'refresh'>,
): void {
    const sweep = sweepOf(selection)
    if (sweep === undefined)
        (selection as { refresh(pattern: unknown): void }).refresh(pattern)
    else {
        refreshOver(sweep)
        for (const followers of RPC_SERVER.following)
            followers.sweep('refresh', sweep)
    }
}
/** Marks the selection stale: drops the cache behind it, never the value. */
export function invalidate<Chosen extends Selection>(
    selection?: Chosen,
    pattern?: PatternOf<Chosen, 'invalidate'>,
): void {
    const sweep = sweepOf(selection)
    if (sweep === undefined)
        (selection as { invalidate(pattern: unknown): void }).invalidate(
            pattern,
        )
    else {
        invalidateOver(sweep)
        for (const followers of RPC_SERVER.following)
            followers.sweep('invalidate', sweep)
    }
}

// 10.1 — `reactive.share` is a static on the factory rather than a free name, the registry's own
// spelling: it CREATES where nothing holds the key, so it belongs with the factory it calls.
reactive.share = share
