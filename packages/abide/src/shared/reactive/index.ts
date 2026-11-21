// THE ONE FACTORY, and the barrel it is the address of. `state`, `memo` and `channel`
// collapsed into overloads on one name — a channel being a value over an array its `patch`
// appends to — and the refusal behind that split survives rather than being reversed: what it
// refused was ONE SIGNATURE WITH AN OPTIONAL PARAMETER, not one name, and overloads handing
// back two result types is the shape its reason forces.
//
// THE ORDER IS FORCED, and getting it wrong breaks the design silently: `() => C` is
// assignable to `(args: A) => C` but not the reverse, so keyed-first swallows the
// unkeyed form whole. Value last means a function argument never reaches it, so a
// function the app wants to STORE rather than run goes inside a record.
//
// The factory lives in the folder's address rather than in a file of its own: `reactive`
// and `Reactive` differ only in case, and a case-insensitive filesystem makes those one
// file (TS1149). An address is the one name CLAUDE.md's file-naming rule exempts.

import type { Failed } from '../Failed.ts'
import type { Issues } from '../Issues.ts'
import { OUTBOX_SENDING } from '../OUTBOX_SENDING.ts'
import type { Rpc } from '../rpc.ts'
import { RPC_SERVER } from '../RPC_SERVER.ts'
import type { Schema } from '../Schema.ts'
import { DECLARED_TAGS } from './DECLARED_TAGS.ts'
import { isReactive } from './isReactive.ts'
import { createKeyed, isKeyed, type Keyed } from './Keyed.ts'
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
export { isKeyed, type Keyed } from './Keyed.ts'
export { NotLanded } from './NotLanded.ts'
export { stopSignal } from './poll.ts'
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
export { structural } from './structural.ts'
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
    transform?: (value: Accepted) => Shaped
    schema?: Gate & Schema<Accepted>
    args?: [Args] extends [never] ? never : ArgsGate & Schema<Args>
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
/**
 * `unknown` where `Body`'s one parameter is optional, and `never` otherwise — `any` included, which
 * would otherwise distribute to both and take every `reactive(x as any)` for a keyed body.
 */
export type OptionalParameter<Body> = 0 extends 1 & Body
    ? never
    : Body extends (...given: infer Given) => unknown
      ? Given extends []
          ? never
          : [] extends Given
            ? unknown
            : never
      : never
/** What a streaming body's generator yields. */
export type ChunkOf<Body extends (...given: never[]) => unknown> =
    Awaited<ReturnType<Body>> extends AsyncGenerator<infer Chunk>
        ? Chunk
        : never
/** `unknown` where `Body` hands back a generator or a promise of one, and `never` otherwise. */
export type Streams<Body extends (...given: never[]) => unknown> =
    Awaited<ReturnType<Body>> extends AsyncGenerator<unknown> ? unknown : never
/** The failures a body handing back a `Reactive` adopts from it (11.12). */
export type AdoptedFailures<Computed> =
    Computed extends Reactive<unknown, never, infer Failures, unknown>
        ? Failures
        : never
/** The chunks a body adopts from a streaming `Reactive` it hands back, else `Otherwise` (11.12). */
export type AdoptedProduced<Computed, Otherwise> =
    Computed extends Reactive<unknown, never, unknown, infer Produced>
        ? Produced
        : Otherwise

/**
 * The `Reactive` one call of an `Rpc` hands back, for each `Rpc` in `Calls` — a union of them where
 * `Calls` is a union, which `reactive` folds into one value.
 */
type CallOf<Calls> =
    Calls extends Rpc<infer Value, infer Args, infer Failures, infer Produced>
        ? ReturnType<Rpc<Value, Args, Failures, Produced>>
        : never
/** What a `Reactive` in `Calls` stores — the union over `Calls`, distributed. */
type StoredOf<Calls> =
    Calls extends Reactive<infer Stored, never, unknown, unknown>
        ? Stored
        : never
/**
 * What `reactive` holds rather than runs: anything but a function, which is a body, or a `Reactive` or
 * `Keyed`, which is called as one. The promise is `Plain`, since a `Reactive` is one too (1.4), and
 * `Accepted` read through it is the value it settles to. NOT DISTRIBUTED: `Held<number | undefined>`
 * spread over the union is `PromiseLike<number> | PromiseLike<undefined>`, and a
 * `Promise<number | undefined>` is neither.
 */
export type Held<Accepted> = [Accepted] extends [
    ((...given: never[]) => unknown) | { invalidate: unknown },
]
    ? never
    : Accepted | (PromiseLike<Accepted> & { invalidate?: never })
/** What a body's value is: the chunks its generator yields where it streams (9.6), else what it settles to. */
export type BodyValue<Body extends (args: never) => unknown> =
    Awaited<ReturnType<Body>> extends AsyncGenerator<infer Chunk>
        ? Chunk[]
        : Awaited<ReturnType<Body>>
/**
 * A body's key: its one parameter, optional or not (11.2), or `never` where it declares none. The
 * `any` guard keeps `reactive(x as any)` from reading as keyed.
 */
export type BodyArgs<Body extends (args: never) => unknown> = 0 extends 1 & Body
    ? never
    : Parameters<Body> extends []
      ? never
      : Parameters<Body>[0]
/** What a body streams, chunk by chunk, or what it adopts from a `Reactive` it hands back (11.12). */
type BodyProduced<Body extends (args: never) => unknown, Otherwise> =
    Awaited<ReturnType<Body>> extends AsyncGenerator<infer Chunk>
        ? Chunk
        : AdoptedProduced<ReturnType<Body>, Otherwise>
/** What `reactive` builds from `Body`: a `Keyed` where it takes a key, a `Reactive` where it takes none. */
export type ReactiveOf<
    Body extends (args: never) => unknown,
    Shaped,
    Gate,
    ArgsGate,
> = [BodyArgs<Body>] extends [never]
    ? Reactive<
          Kept<Shaped>,
          BodyValue<Body>,
          | AdoptedFailures<ReturnType<Body>>
          | Refusals<Shaped, Gate, BodyValue<Body>>,
          BodyProduced<Body, Kept<Shaped>>
      >
    : Keyed<
          Kept<Shaped>,
          BodyArgs<Body>,
          BodyValue<Body>,
          | AdoptedFailures<ReturnType<Body>>
          | Refusals<Shaped, Gate, BodyValue<Body>, ArgsGate, BodyArgs<Body>>,
          BodyProduced<Body, Kept<Shaped>>
      >

/**
 * A value the scope owns outright, opening at `initial`, or at what a promise of it settles to.
 *
 * FIRST, AHEAD OF THE BODY: without `strictNullChecks` `undefined` is assignable to a function type,
 * so `reactive<User | undefined>(undefined)` behind the body typed a computed value. `Held` turns
 * every function away, so a body never stops here.
 *
 * REQUIRED: against an optional parameter the checker infers `Accepted` with `undefined` taken out,
 * so `reactive(maybe)` was a value that refused the `undefined` it opened with (4.15). A function to
 * STORE rather than run is wrapped — `reactive({ handler })` — since a function here is a body.
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
 * A value `body` produces, run again when a value it read changes: keyed where it declares a
 * parameter (11.2, an optional one included), and a stream where it hands back a generator (9.6).
 * What it is, is read off `Body` by `ReactiveOf`, so one signature serves every shape.
 *
 * `Value` IS READ ONLY THROUGH `Body`'s DEFAULT: `reactive<number[]>(() => …)` names the value the
 * body produces, and with explicit type arguments the rest take their defaults, so `Body` is `() =>
 * number[]` and the body is checked against it. Inferred, `Value` is never read.
 *
 * `unknown` FOR THE RETURN IN THE CONSTRAINT: a return type there is a contextual type for the body,
 * and `Promise.reject(…)` in a body inferred its promise as one of a generator from it.
 *
 * 19.24 — `Body` IS READ OFF THE BODY ALONE, hence `NoInfer` in the options: a `Schema<{ id: number }>`
 * beside an async body would otherwise pull the body's value toward the schema's.
 */
export function reactive<
    Value = never,
    Body extends (args: never) => unknown = () => Value,
    Shaped = BodyValue<Body>,
    Gate = Schema<BodyValue<Body>>,
    ArgsGate = Schema<BodyArgs<Body>>,
>(
    body: Body,
    options?: Shaping<
        BodyValue<NoInfer<Body>>,
        Shaped,
        BodyArgs<NoInfer<Body>>,
        Gate,
        ArgsGate
    >,
): ReactiveOf<Body, Shaped, Gate, ArgsGate>
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
    // spelling concrete enough to pass straight through — any of `<unknown, unknown>`,
    // `<never, unknown, never>`, `<never, never, never>` — is one the overloads are
    // not all assignable to, once `Failures` carries a bound. The implementation signature
    // is the bridge nothing calls directly, so the casts below are where the
    // overloads' promises are made good.
    ...given: [first?: unknown, options?: unknown]
): unknown {
    const keyed = isKeyedBody(given[0])
    // 11.32 — ON A SERVER, OUTSIDE A REQUEST, THE VALUE IS FILED: a forwarder to one instance per
    // request, and to the one built here where there is no request at all — or, for a value with a
    // `store`, built where it is first reached (11.71). `global` is what keeps a value process-wide
    // (11.34).
    const options = given[1] as
        { global?: boolean; store?: unknown; tags?: string[] } | undefined
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
 * `reactive` for a framework ambient — `route`, `online` — filed per scope whatever the load order.
 *
 * `reactive` decides at construction, and a value abide itself builds at import can be built before
 * the server has installed its provider, which made it one value for every request in the process.
 * A forwarder resolves to its home wherever no scope is current, so in a browser this is the one
 * value it always was, behind one more call.
 */
export const ambient = ((...given: [first?: unknown, options?: unknown]) => {
    const keyed = isKeyedBody(given[0])
    return scoped(() => build(given, keyed))
}) as unknown as typeof reactive

/**
 * `reactive` over a handler's plain function or value, for `declare` — or the
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
    const given: [unknown, unknown] = [body, options]
    const keyed = isKeyedBody(body)
    if (!keyed && outsideScope(false))
        return scoped(
            () => build(given, keyed),
            true,
            (options as { global?: boolean } | undefined)?.global === true,
        )
    return reactive(body as () => unknown, options as undefined)
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
function build(
    given: [first?: unknown, options?: unknown],
    keyed: boolean,
): unknown {
    const [first, options] = given
    if (typeof first === 'function' && !isReactive(first)) {
        const body = first as (args?: unknown) => unknown
        if (keyed)
            return createKeyed(
                'reactive',
                body,
                (options ?? undefined) as Parameters<typeof createKeyed>[2],
            )
        return createReactive(
            'reactive',
            body as (args: unknown) => unknown,
            undefined,
            undefined,
            options as Parameters<typeof createReactive>[4],
        )
    }
    return createReactive(
        'reactive',
        null,
        undefined,
        // 4.14 AGAINST 4.15: called with no argument is empty, and called with `undefined` is loaded.
        given.length === 0 ? NO_INITIAL : first,
        options as Parameters<typeof createReactive>[4],
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
