// `rpc`: a value, a function or a source given an address (16.2), answering the verbs it can (16.111).
// The IN-PROCESS arm is what a
// server-side caller, a page rendering on the server and a test all reach; the WIRE arm is what a
// browser gets in its place (16.28, `#ui/wire.ts`) — and it is `declare` over a body that fetches,
// which is why this module is in the seam both reach rather than in the server's.
//
// A HANDLER IS A `reactive` OR BECOMES ONE (16.1), so an `Rpc` is not a second kind of value: the
// call hands back the handler's own `Reactive` (16.3), and every probe, trigger and failure on it is
// the reactive core's — the `Rpc`'s own `busy`, `ready`, `refresh` and `invalidate` are the
// handler's, passed through. What this file adds is the normalizing — a plain function or a value becomes the
// `reactive` it would have been (16.6) — and the method.
//
// A HANDLER DECLARING `middleware` IS REACHED THROUGH ITS RUNGS (16.11), in process as over the wire:
// the call hands back a value whose body runs the onion once per args, per request, over the
// handler's own.

import { applyPatch } from './applyPatch.ts'
import { DERIVED_ARGS } from './DERIVED_ARGS.ts'
import { type Failed, isFailed, isFailedNamed } from './Failed.ts'
import { GLOBAL_GETS } from './GLOBAL_GETS.ts'
import { HandlerRoute } from './HandlerRoute.ts'
import { IN_PROCESS_ORIGIN } from './IN_PROCESS_ORIGIN.ts'
import { isAsyncIterable } from './isAsyncIterable.ts'
import { isServer } from './isServer.ts'
import type { Issues } from './Issues.ts'
import type { Logged } from './ledger.ts'
import { namedLogger } from './log.ts'
import type { Match } from './Match.ts'
import { compose, type Rung } from './Middleware.ts'
import { unmounted } from './mount.ts'
import { outbox, type QueuedCall } from './outbox.ts'
import type { PipeStatus } from './pipe.ts'
import { principalRotated } from './principalRotated.ts'
import { REACH_CALL } from './REACH_CALL.ts'
import { answerOfCall } from './reactive/answerOfCall.ts'
import {
    acceptedArgs,
    contractOf,
    type Gated,
    gateOf,
    type HeldToAnnotation,
    keyOf,
} from './reactive/argsContract.ts'
import type { CALL_ENTRY } from './reactive/CALL_ENTRY.ts'
import { callLoad } from './reactive/callLoad.ts'
import {
    type KeptIn,
    KEYED_OF,
    type Memo,
    type MemoValue,
    readableOf,
    writeOf,
    type Written,
} from './reactive/createMemo.ts'
import { DECLARED_TAGS } from './reactive/DECLARED_TAGS.ts'
import {
    type AdoptedFailures,
    type BodyProduced,
    type BodyValue,
    derived,
    handlerValue,
    type Held,
    isKeyed,
    type Kept,
    keyedValue,
    type Reactive,
    refresh,
    type Refusals,
    type Selection,
    type Shaping,
    type Sourced,
    STREAMING,
} from './reactive/index.ts'
import { isReactive } from './reactive/isReactive.ts'
import { isThenable } from './reactive/isThenable.ts'
import { MEMO_BRAND } from './reactive/MEMO_BRAND.ts'
import { MUTATION } from './reactive/MUTATION.ts'
import type { PatchOp } from './reactive/patchLog.ts'
import {
    chunksOfStream,
    nameLoad,
    patchInto,
    produceInto,
    streamingOrSettled,
} from './reactive/producer.ts'
import { isStreamBody } from './reactive/Reactive.ts'
import { builtHere, isForwarder } from './reactive/scoped.ts'
import { checkArgs, refuse } from './refuse.ts'
import { RPC_SERVER } from './RPC_SERVER.ts'
import { rpcRequest } from './rpcRequest.ts'
import type { Schema } from './Schema.ts'
import { SOURCE_KIND } from './SOURCE_KIND.ts'
import { SOURCE_MEMBERS } from './SOURCE_MEMBERS.ts'
import { surfaceName } from './surfaceName.ts'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * What a call is handed beside its args: who may end its load (16.48), and what stands in for an
 * answer a browser could not get (16.81).
 */
export type CallOptions<Args = unknown, Value = unknown> = {
    signal?: AbortSignal | undefined
    offline?(args: Args): Value
}

/**
 * A declared handler: callable for what its body answers, with the handler's own members and its
 * mount.
 *
 * 16.3 — the call answers as the handler's body does (`CallAnswer`); the members below are the
 * handler's, passed through.
 *
 * 16.8 — AND ITS FAILURES CARRY THE TRANSPORT'S `HttpError`, which no handler declares and every
 * call can be answered with: a body over `maxBodySize` (413), a closed `crossOrigin` (403), a
 * `timeout` (504), and any failure status whose body was not a `Failed`, rebuilt by `answered`. And
 * the `ValidationError` the wire holds args to the annotation with (19.9), where `Annotated` says it
 * derives a schema at all.
 */
export type Rpc<Value, Args, Failures = never, Produced = Value> = ReadRpc<
    Value,
    Args,
    Failures,
    Produced
> & {
    /** 11.76 — the owner's write of the value for `args`, past every rung; `set(value)` where it takes no args at all (11.80). */
    set(...given: Written<Args, Value>): void
    /** 11.76 — the owner's mutation of the value for `args` in place, past every rung; `patch(mutate)` where it takes no args at all (11.80). */
    patch(...given: Written<Args, (value: Value) => void>): void
}

/**
 * 16.111, 16.117 — an `Rpc` less the owner's writes: what an `rpc` over a source or a value is, its
 * writes typed only where its verbs answer them (`Answering`). What a reader of any `Rpc` infers from.
 */
export type ReadRpc<Value, Args, Failures = never, Produced = Value> = ((
    ...args: undefined extends Args
        ? [args?: Args, options?: CallOptions<Args, NoInfer<Value>>]
        : [args: Args, options?: CallOptions<Args, NoInfer<Value>>]
) => CallAnswer<
    Value,
    Failures | Failed<'HttpError', undefined> | Annotated<Args>,
    Produced
>) & {
    /** 16.111 — the verb a call is sent with. */
    method: Method
    /** 16.111 — every verb the `rpc` answers at its address, `method` first. */
    methods: readonly Method[]
    description: string | undefined
    /** 11.77 — the value for `args` now, then after each change. */
    readable(
        ...args: undefined extends Args ? [args?: Args] : [args: Args]
    ): ReadableStream<Value>
    /** 46.1 — the calls the outbox holds for this handler, narrowed by a pattern. */
    outbox(pattern?: Partial<Args>): QueuedCall<Value>[]
    refresh(pattern?: Partial<Args>, options?: TriggerOptions): void
    invalidate(pattern?: Partial<Args>, options?: TriggerOptions): void
    isError<Name extends string>(
        error: unknown,
        name: Name,
    ): error is Extract<
        Failures | Failed<'HttpError', undefined> | Annotated<Args>,
        { name: Name }
    >
    /**
     * The call's address, resolved against the mount.
     *
     * 16.9, 16.10 — a mutation's takes no args.
     */
    url(...args: undefined extends Args ? [args?: Args] : [args: Args]): string
    /** The same call, handed back as the `Response` (16.42). */
    raw(args?: Args, init?: RequestInit): Promise<Response>
    /** Where the handler answers: its route under the mount, once its file has loaded (16.88). */
    address: string | undefined
    /** What MCP and OpenAPI name the handler, once it has an address (20.13, 20.24). */
    readonly tool: string | undefined
    timeout: number | undefined
    crossOrigin: boolean | string[]
    maxBodySize: number | undefined
    clients: Clients
    /**
     * Whether the handler declared rungs.
     *
     * 18.8 — rungs a value pushed over the mux would not pass.
     */
    guarded: boolean
}

/**
 * 16.3 — what one call of an `Rpc` answers, as the handler's body answers: the stream of its chunks
 * where it streams — `Produced` is a chunk where `Value` is the chunks — and otherwise the promise of
 * its value, rejected with its refusal (16.3).
 */
export type CallAnswer<Value, Failures, Produced> = ([Value] extends [Produced]
    ? [Produced] extends [Value]
        ? Promise<Value>
        : AsyncIterable<Produced>
    : AsyncIterable<Produced>) & {
    // Typed only: the value and the refusals a `reactive.derived` adopting the answer serves as its own
    // (11.12), and what the build reads a handler's value off (19.21).
    readonly [CALL_ENTRY]?:
        | {
              readonly value: Value
              readonly failures: Failures
          }
        | undefined
}

/**
 * The `ValidationError` the wire answers args that do not hold to the schema 19.9 derives from
 * `Args`, and `never` where the derived schema is no object's and the wire holds nothing to it.
 *
 * MIRRORS `argsSchemaOf`, which reads the same `Args` off the `Rpc`'s call: an object's schema is
 * derived for ONE record, `undefined` dropped — not a scalar, a list, a callable or a union of
 * records (`anyOf`), and not `any`, `unknown` or `object`, which constrain nothing. `object` is told
 * from `{}`, the one other record with no keys, by `string`, which only `{}` takes.
 */
export type Annotated<Args> = 0 extends 1 & Args
    ? never
    : unknown extends Args
      ? never
      : Derived<Exclude<Args, undefined>>
// `Member` is distributed over and `Whole` is not: a member that is not the whole is one arm of a union.
type Derived<Member, Whole = Member> = Member extends
    readonly unknown[] | ((...given: never[]) => unknown)
    ? never
    : Member extends object
      ? [Whole] extends [Member]
          ? [keyof Member] extends [never]
              ? [string] extends [Member]
                  ? Failed<'ValidationError', Issues<Whole>>
                  : never
              : Failed<'ValidationError', Issues<Whole>>
          : never
      : never

/** Which generated surfaces carry a handler (20.1). */
export type Clients = {
    ui?: boolean | undefined
    mcp?: boolean | undefined
    cli?: boolean | undefined
    openapi?: boolean | undefined
}

export type RpcContext<Args = unknown> = { request: Request; args: () => Args }

/**
 * The context key holding the args as sent.
 *
 * 11.26 — THE ARGS AS SENT, carried on the context under a key no rung spells, so the reach at the
 * onion's center keys the value by them rather than by what the gate made of them.
 */
const SENT: unique symbol = Symbol('abide.sent')

/**
 * What a rung's `next` answers as a declaration types it: opaque, so what the rung answers in the
 * handler's place is told apart from the answer it passes on.
 */
declare const REACHED: unique symbol
type Reached = { readonly [REACHED]: true }

/**
 * The refusals a declaration's rungs answer with, read off what each answers.
 *
 * 16.86 — A REFUSAL A RUNG NAMES IS THE `Rpc`'s, and one it does not name is not: a `Failed` whose
 * name is `string` (a `Middleware` declaring no refusals) would widen every name the union narrows
 * by, and a rung answering `unknown` names none.
 */
type RungRefusals<Answers extends readonly unknown[]> =
    Answers[number] extends infer Answer
        ? Answer extends Failed<infer Name, unknown>
            ? string extends Name
                ? never
                : Answer
            : never
        : never

/** One rung of a handler's `middleware`, answering `Answer` in the handler's place or passing on. */
type HandlerRung<Args, Answer> = (
    next: (ctx?: RpcContext<Args>) => Promise<Reached>,
    ctx: RpcContext<Args>,
) => Answer | Promise<Answer>

export type RpcOptions<
    Args = unknown,
    Answers extends readonly unknown[] = unknown[],
> = {
    /** 16.112 — the verbs answered, in place of the ones the value is answered by (16.111). */
    methods?: readonly Method[] | undefined
    /** 16.113 — the address answered at, in place of the handler file's route. */
    address?: string | undefined
    /** 16.118 — for a table: the columns its rows are read with, and the only ones a write may name. */
    columns?: readonly string[] | undefined
    description?: string | undefined
    /**
     * 16.86 — one rung per answer in `Answers`, each read in context: a rung's own refusals are
     * inferred where the list is written at the declaration.
     *
     * The plain array arm is the context a list built by a GENERIC helper is typed in: the mapped
     * arm is over `Answers`, still being inferred, so the helper's own `Args` read nothing there and
     * are `unknown`. It adds no refusal of its own — `Answers` is still read off the list — and
     * no `Args` either: a `Middleware` asking `args: () => unknown` of its context would otherwise
     * widen a keyed handler's to `unknown`, which its `Keyed` then refuses.
     */
    middleware?:
        | { [At in keyof Answers]: HandlerRung<Args, Answers[At]> }
        | readonly HandlerRung<NoInfer<Args>, unknown>[]
        | undefined
    timeout?: number | undefined
    clients?: Clients | undefined
    crossOrigin?: boolean | string[] | undefined
    maxBodySize?: number | undefined
    /**
     * 16.89 — what a run of a mutation `refresh`es once it answers without a refusal, or what
     * returns it for the call's `Args`. Never a `GET`'s (16.92).
     */
    refreshes?:
        | Refreshed
        | ((args: Args) => Refreshed | PromiseLike<Refreshed>)
        | undefined
}

/**
 * 16.89 — what `refreshes` names: a tag, a `Selection`, or a `memo` or an `Rpc` beside its pattern
 * (13.12) — `[boards, { personId }]` is `boards.refresh({ personId })`. 16.104 — and an `Rpc`'s
 * trigger options: `[whoAmI, undefined, { caller: true }]` is `whoAmI.refresh(undefined, { caller:
 * true })`, the calling browser's copies alone.
 */
type Refreshed = readonly (
    | string
    | Selection
    | readonly [
          { refresh(pattern: never, options?: TriggerOptions): void },
          Record<string, unknown> | undefined,
          TriggerOptions?,
      ]
)[]

/**
 * A handler `declare` builds the value of: a plain function or a value, which no `Reactive` or
 * `Keyed` is.
 *
 * Told by a member both carry and neither of those does. Without it a value handed in with a
 * value's option — `GET(reactive(f), { ttl })` — fell through its own arm to a plain one, and the
 * option was dropped by a value that had already been built.
 */
// 16.117 — and a source's stream, which a table, a pipe and a ledger take their own signature by.
export type Plain = {
    invalidate?: never | undefined
    writable?: never | undefined
}

/**
 * What narrows a trigger on an `Rpc` beside its pattern: `caller`, the `principal.caller` of the one
 * browser whose followed copies it reaches (18.37) — `true` for the one making this request (18.39).
 */
export type TriggerOptions = { caller?: string | true | undefined }

/** A handler's options: `RpcOptions` for a mutation, less `refreshes` for a `GET` (16.92). */
type OptionsOf<
    Writes extends boolean,
    Args,
    Answers extends readonly unknown[],
> = [Writes] extends [true]
    ? RpcOptions<Args, Answers>
    : Omit<RpcOptions<Args, Answers>, 'refreshes'>

/**
 * The signature `GET` and the four mutations share: a handler in, its `Rpc` out.
 *
 * THREE SIGNATURES, ONE PER IDEA, where each shape of handler was an overload of its own: a value, a
 * `Reactive` or `Keyed` already built, and a body, which `memo` reads (`BodyValue`, `ReactiveOf`'s
 * reading of `Args` and `Result`).
 *
 * THE BODY COMES FIRST: a generic call in the options — a rung helper, 16.86 — is resolved once,
 * against the contextual type of the first signature it is checked under, and that answer is kept
 * for the rest. The body's `Args` is read off the handler, a `Keyed`'s off its call signature as the
 * built form would; the value form's would be `undefined`, and every rung helper was typed for it.
 * The body's `& Plain` turns a `Reactive` or `Keyed` on to the built form, and the value form turns
 * every function away.
 *
 * 16.92 — `Writes` is false for `GET` alone, whose options have no `refreshes`.
 */
/**
 * 16.110 — A HANDLER'S VALUE OPTIONS ARE A `memo`'S, its pace among them: `throttle` and `debounce`
 * hold back what every follower is sent, which a reader's own pacing could not. And its `store` is a
 * memo's, `KeptIn`: a store of the value, or one inferring nothing as `store.sqlite(db, 'calls')` does.
 */
type HandlerShaping<Shaping> = Omit<Shaping, 'store'>
type HandlerStore<Args, Value> = { store?: KeptIn<Args, Value> | undefined }

type Declare<Writes extends boolean> = {
    // 16.70 — an `rpc` already, handed back as it is: a server block's export declared by one.
    <
        Declared extends ((...given: never[]) => unknown) & {
            methods: readonly Method[]
            address: string | undefined
        },
    >(
        handler: Declared,
    ): Declared
    // 11.2 — keyed where the body declares a parameter, an optional one included; 16.87 — `Args`
    // read off the `args` the options declare where the parameter carries no annotation. A body
    // declaring none infers nothing, and `undefined` is the key an unkeyed `Rpc` is called with.
    // `Args` RAW in the options, never behind a conditional: a generic rung helper listed there
    // (16.86) infers its own `Args` from them while this one is unfixed, and a conditional is
    // evaluated then rather than carried — every such rung was typed for `undefined`.
    <
        Args = undefined,
        Result = unknown,
        Shaped = BodyValue<Result>,
        Gate = Schema<BodyValue<Result>>,
        ArgsGate = Schema<Args>,
        Answers extends readonly unknown[] = unknown[],
    >(
        handler: ((args: Args) => Result) & Plain,
        options?: HandlerShaping<
            Shaping<BodyValue<NoInfer<Result>>, Shaped, Args, Gate, ArgsGate>
        > &
            Sourced<NoInfer<Args>> &
            HandlerStore<NoInfer<Args>, NoInfer<Kept<Shaped>>> &
            OptionsOf<Writes, Args, Answers>,
    ): Rpc<
        Kept<Shaped>,
        Args,
        | AdoptedFailures<Result>
        | Refusals<Shaped, Gate, BodyValue<Result>, ArgsGate, Args>
        | RungRefusals<Answers>,
        BodyProduced<Result, Kept<Shaped>>
    >
    // 16.6 — a memo, served as the keyed value it is: `rpc(digest.status)`. 16.111 — read alone, its
    // writes typed where `methods` names their verbs.
    <
        Args,
        Result,
        Answers extends readonly unknown[] = unknown[],
        const Methods extends readonly Method[] = ['GET'],
    >(
        handler: Memo<Args, Result>,
        options?: OptionsOf<Writes, Args, Answers> & {
            methods?: Methods | undefined
        },
    ): ReadRpc<
        MemoValue<Result>,
        Args,
        RungRefusals<Answers>,
        BodyProduced<Result, MemoValue<Result>>
    > &
        HeldWrites<Methods, Args, MemoValue<Result>>
    // 16.117 — a table: its rows read by a JSON match, written by key and deleted by a match.
    <
        Row extends Record<string, unknown>,
        Answers extends readonly unknown[] = unknown[],
        const Methods extends readonly Method[] = [
            'GET',
            'PUT',
            'PATCH',
            'DELETE',
        ],
    >(
        handler: TableFace<Row>,
        options?: OptionsOf<Writes, Match<Row> | undefined, Answers> & {
            methods?: Methods | undefined
        },
    ): ReadRpc<Row[], Match<Row> | undefined, RungRefusals<Answers>> &
        Answering<
            Methods,
            'PUT',
            { set(rows: Row | readonly Row[]): Promise<unknown> }
        > &
        Answering<
            Methods,
            'PATCH',
            {
                patch(
                    rows: Partial<Row> | readonly Partial<Row>[],
                ): Promise<unknown>
            }
        > &
        Answering<
            Methods,
            'DELETE',
            { delete(match: Match<Row>): Promise<unknown> }
        >
    // 16.117 — a job: its status read and followed, and a run started ahead of its schedule.
    <
        Status,
        Input,
        Answers extends readonly unknown[] = unknown[],
        const Methods extends readonly Method[] = ['GET', 'POST'],
    >(
        handler: JobFace<Status, Input>,
        options?: OptionsOf<Writes, undefined, Answers> & {
            methods?: Methods | undefined
        },
    ): ReadRpc<Status, undefined, RungRefusals<Answers>> &
        Answering<Methods, 'POST', { run(input?: Input): Promise<Status> }>
    // 16.117 — a ledger: its entries read in order from a position or a cursor, and appended to.
    <
        Entry,
        Answers extends readonly unknown[] = unknown[],
        const Methods extends readonly Method[] = ['GET', 'POST'],
    >(
        handler: LedgerFace<Entry>,
        options?: OptionsOf<Writes, LedgerFrom | undefined, Answers> & {
            methods?: Methods | undefined
        },
    ): ReadRpc<
        Logged<Entry>[],
        LedgerFrom | undefined,
        RungRefusals<Answers>
    > &
        Answering<Methods, 'POST', { append(entry: Entry): Promise<number> }>
    // 16.117 — a pipe: its status read and followed, and an item pushed through it for its answer.
    <
        In,
        Out,
        Answers extends readonly unknown[] = unknown[],
        const Methods extends readonly Method[] = ['GET', 'POST'],
    >(
        handler: PipeFace<In, Out>,
        options?: OptionsOf<Writes, undefined, Answers> & {
            methods?: Methods | undefined
        },
    ): ReadRpc<PipeStatus, undefined, RungRefusals<Answers>> &
        Answering<Methods, 'POST', { push(input: In): Promise<Out> }>
    // 16.1 — a value, `reactive` given an address, which takes a `reactive`'s options beside the
    // address's (16.6), and no source's (11.81). Never a function: a handler's function is its body,
    // the first signature's (16.1). 16.111 — read alone, its writes typed where `methods` names them.
    <
        Accepted,
        Shaped = Accepted,
        Gate = Schema<Accepted>,
        Answers extends readonly unknown[] = unknown[],
        const Methods extends readonly Method[] = ['GET'],
    >(
        handler: [Accepted] extends [(...given: never[]) => unknown]
            ? never
            : Held<Accepted>,
        options?: HandlerShaping<Shaping<Accepted, Shaped, never, Gate>> &
            HandlerStore<undefined, NoInfer<Kept<Shaped>>> &
            OptionsOf<Writes, undefined, Answers> & {
                methods?: Methods | undefined
            },
    ): ReadRpc<
        Kept<Shaped>,
        undefined,
        Refusals<Shaped, Gate, Accepted> | RungRefusals<Answers>
    > &
        HeldWrites<Methods, undefined, Kept<Shaped>>
}

/**
 * 16.111, 16.117 — `Member` where `Methods` names the `Verb` it writes by, and nothing where it does
 * not: an `rpc`'s face is the verbs it answers. `methods` the type cannot read names every verb.
 */
type Answering<
    Methods extends readonly Method[],
    Verb extends Method,
    Member,
> = Verb extends Methods[number] ? Member : unknown

/** 16.115-16.117 — a memo's or a value's `set` by `PUT` and `patch` by `PATCH`, its owner's writes (11.76). */
type HeldWrites<Methods extends readonly Method[], Args, Value> = Answering<
    Methods,
    'PUT',
    { set(...given: Written<Args, Value>): void }
> &
    Answering<
        Methods,
        'PATCH',
        { patch(...given: Written<Args, (value: Value) => void>): void }
    >
/** 16.117 — a table as `rpc` reads it: called for rows, and written by key. */
type TableFace<Row> = ((match?: Match<Row>) => Row[]) & {
    set(rows: Row | readonly Row[]): void
    patch(rows: Partial<Row> | readonly Partial<Row>[]): void
    delete(match: Match<Row>): number
    readonly writable: WritableStream<Row>
}

/** 16.117 — a job as `rpc` reads it: a status memo and a run. */
type JobFace<Status, Input> = {
    status: Memo<undefined, Status>
    run: (input?: Input) => Promise<Status>
    stop: () => Promise<Status>
}

/** 16.117 — a ledger as `rpc` reads it: a read from a position or a cursor, and an append. */
type LedgerFace<Entry> = ((
    from?: number | { cursor: string },
) => ReadableStream<Logged<Entry>>) & {
    append: (
        entry: Entry,
        options?: { key?: string | undefined },
    ) => Promise<number>
}

/** 16.117 — where a ledger's `rpc` reads from: a position, or a named cursor. */
type LedgerFrom = { from?: number | undefined; cursor?: string | undefined }

/** 16.117 — a pipe as `rpc` reads it: a call for an item's answer, and its status. */
type PipeFace<In, Out> = ((input: In, signal?: AbortSignal) => Promise<Out>) & {
    readonly status: Memo<undefined, PipeStatus>
    readonly readable: ReadableStream<unknown>
    stop(): Promise<void>
}

/** What a handler's triggers do before a call has built its value: nothing, there being no entry (13.19). */
const UNREACHED = {
    refresh: (): void => undefined,
    invalidate: (): void => undefined,
}

/** Builds the handler declarer for one method — what `GET`, `POST` and the rest are. */
export function declare<Declared extends Method>(
    method: Declared,
): Declare<Declared extends 'GET' ? false : true> {
    return ((handler: unknown, options?: RpcOptions): unknown => {
        // 16.92 — for a caller the types did not reach.
        if (method === 'GET' && options?.refreshes !== undefined)
            throw new Error(
                'abide: a `GET` was declared with `refreshes`, which only a mutation takes. Refresh from the write that changed the value. RULEBOOK 16.92.',
            )
        // 16.6, and 16.7's `ttl` of 0 on a mutation over a body: each call is a write, so nothing a
        // previous call produced is served to the next one. 13.16 — and marked, so a sweep never
        // sends it again. A value has no body to run again, and takes no `ttl` (11.81).
        const cacheOptions =
            method === 'GET' ? undefined : { ttl: 0, [MUTATION]: true as const }
        // 16.6 — A PLAIN FUNCTION'S VALUE IS BUILT WITH THE WHOLE OPTIONS OBJECT: `reactive` reads
        // the keys that are its own and passes over the address's, so nothing splits them. 16.7's
        // `ttl` is a default the handler's own overrides.
        const value = handlerValue(
            handler,
            cacheOptions === undefined || typeof handler !== 'function'
                ? options
                : {
                      ...cacheOptions,
                      ...options,
                      // A `ttl` given `undefined` declares none, and 0 stands.
                      ttl:
                          (options as { ttl?: number | undefined } | undefined)
                              ?.ttl ?? cacheOptions.ttl,
                  },
        )
        const keyed = isKeyed(value)
        // 16.32 — a handler whose body is an async generator answers its chunks; a browser's copy is
        // told so by the build (`streamingCopy`), since its body is the wire's.
        let wireCopy = false
        let streams =
            typeof handler === 'function' &&
            !isReactive(handler) &&
            !isKeyed(handler) &&
            isStreamBody(handler as (args: never) => unknown)
        // 19.7 — the handler's `args` gate and its parameter defaults, on the `Rpc` too, for the
        // wire to coerce and key by. 11.27, 11.29 — THE DEFAULTS ARE APPLIED AT THE CALL rather than
        // left to the value's own reach: a value behind rungs is keyed ahead of the handler's, and
        // the seed buffer files the call by the args it was handed.
        const contract = contractOf(keyed ? value : undefined)
        const reach = (args?: unknown): unknown =>
            keyed ? (value as (args: unknown) => unknown)(args) : value
        // 16.11, 16.12 — THE RUNGS, IN REGISTRATION ORDER, around the reach. Built once, at the
        // declaration (16.14); a value keyed by args, so a second call with the same args in one
        // request joins the first (1.8) and a server files one per request (11.32).
        // `Reached` is the declaration's view of `next`; at run time it answers the handler's value.
        const rungs = (options?.middleware ?? []) as readonly Rung<
            RpcContext,
            unknown
        >[]
        // A rung that handed `next` a context of its own making chose those args.
        const argsOf = (ctx: RpcContext): unknown =>
            SENT in ctx ? (ctx as { [SENT]: unknown })[SENT] : ctx.args()
        const contextOf = (args: unknown): RpcContext =>
            ({
                request: RPC_SERVER.request(),
                args: argsOnce(gateOf(contract), args),
                [SENT]: args,
            }) as RpcContext
        // 16.32 BEHIND RUNGS — A STREAM'S CHUNKS ARE FORWARDED, not collected. The center of the
        // onion is an async function, and a `Reactive` is thenable (1.4), so handing a streaming value
        // out through it would wait out the whole run and answer the accumulation once it closed. So
        // the center waits only until the value settles or turns out to stream (9.6), and hands a
        // stream on as its chunks — a generator, which is not thenable. The value the call reaches
        // resolves to it and is a stream of its own from then (9.6), so a second call joining it
        // (1.8) reads the same accumulation. A refusal a rung answers with is the value's refusal.
        const center = async (args: unknown): Promise<unknown> => {
            const reached = reach(args)
            const started = performance.now()
            try {
                const settled = await streamingOrSettled(reached)
                return settled === STREAMING ? chunksOfStream(reached) : settled
            } finally {
                RPC_SERVER.handled?.(rpc, performance.now() - started)
            }
        }
        const onion =
            rungs.length === 0
                ? null
                : compose(rungs, async (ctx: RpcContext) => center(argsOf(ctx)))
        const answer =
            onion === null
                ? center
                : (args: unknown): Promise<unknown> => onion(contextOf(args))
        // 16.89 — `refreshes` IS THE OUTERMOST LAYER, outside every rung, so what any of them
        // refuses with refreshes nothing; and it is no rung, so a guarded `GET`'s follow (18.8) does
        // not count it as one.
        const refreshes = options?.refreshes
        const wrapped =
            onion === null && refreshes === undefined
                ? null
                : keyedValue(
                      refreshes === undefined
                          ? answer
                          : (args: unknown) =>
                                answerThenRefresh(
                                    answer(args),
                                    () =>
                                        refreshEach(
                                            typeof refreshes === 'function'
                                                ? refreshes(args)
                                                : refreshes,
                                        ),
                                    () => rpc.address ?? 'a handler',
                                ),
                      cacheOptions,
                  )
        const reachThrough =
            wrapped === null ? reach : (wrapped as (args: unknown) => unknown)
        // 16.3 — the handler's own `Reactive`. A `Keyed` reaches its entry, which is 1.7's start
        // and 1.8's join; an unkeyed value has one entry and the call is the reach of it.
        //
        // 41.13 — AND REPORTED, where the call is made in a page's render: the browser's own call for
        // this handler and these args is then answered from what this one reached, rather than by
        // running the handler again. In a browser nothing fills the slot, so the report is one load
        // of a `null`.
        //
        // 15.8 — AND REFUSED AHEAD OF THE HANDLER where the args leave a parameter of its route no
        // spelling (30.3, 30.19), as the wire refuses them: a render and the browser's call then
        // reach the same refusal, and there is no request for the render to report.
        //
        // THE ROUTE IS COMPILED ONCE PER ADDRESS, which is stamped after the declaration (16.10),
        // and every call, `rpc.url` and `rpc.raw` read it.
        let route: HandlerRoute | undefined
        const routeAt = (address: string): HandlerRoute => {
            if (route?.address !== address) route = new HandlerRoute(address)
            return route
        }
        const reachCall = (given?: unknown, options?: CallOptions): unknown => {
            // 15.8, 19.9 — the args every way of calling the handler is held to.
            let args: unknown
            try {
                args = acceptedArgs(rpc, given)
            } catch (refused) {
                if (!isFailed(refused)) throw refused
                return derived(() => refused)
            }
            const route =
                rpc.address === undefined ? undefined : routeAt(rpc.address)
            if (route?.segments !== undefined) {
                try {
                    route.path(args as Record<string, unknown> | undefined)
                } catch (refused) {
                    return derived(() => refused)
                }
            }
            const reached = callLoad(
                reachThrough,
                args,
                options?.signal,
                rpc.timeout ?? RPC_SERVER.timeout(),
                options?.offline as ((args: unknown) => unknown) | undefined,
            )
            RPC_SERVER.reached?.(rpc, args, reached, route)
            // 38.205 — what `settled` names a call still in flight by.
            nameLoad(reached, method, rpc.address)
            return reached
        }
        // 16.3 — WHAT A CALL ANSWERS IS WHAT THE HANDLER'S BODY ANSWERS: a promise of the value or
        // its refusal, or the stream of its chunks. The value the call reached stays the handler's,
        // carried on the answer for a `reactive.derived` handing it back whole to adopt (11.12).
        const call = (given?: unknown, options?: CallOptions): unknown =>
            answerOfCall(reachCall(given, options), streams)
        // THE HANDLER'S OWN TRIGGERS, handed the pattern, which a `Keyed` narrows by.
        //
        // 13.19 — AND NOT YET BUILT, NEITHER BUILDS IT: building an unkeyed value starts its body
        // (1.7), so a trigger over a server's never-called `POST(async () => …)` would run the write.
        // Until a call reaches it the handler has no entry, and a trigger does nothing.
        const built = value as Record<
            'refresh' | 'invalidate',
            (pattern?: unknown) => void
        >
        const faceHere = (): typeof built =>
            builtHere(value) ? built : UNREACHED
        const rpc = Object.assign(call, contract, {
            [REACH_CALL]: reachCall,
            // 16.32 — the build's word that a browser's copy streams, its body being the wire's.
            [STREAMING_COPY]: (): void => {
                streams = true
            },
            // A browser's copy of the handler, whose value is the wire's rather than its own.
            [WIRE_COPY]: (): void => {
                wireCopy = true
            },
            method,
            methods: [method] as readonly Method[],
            description: options?.description,
            address: undefined as string | undefined,
            timeout: options?.timeout,
            crossOrigin: options?.crossOrigin ?? false,
            maxBodySize: options?.maxBodySize,
            clients: options?.clients ?? {},
            guarded: rungs.length > 0,
            [DERIVED_ARGS]: undefined as HeldToAnnotation[typeof DERIVED_ARGS],
            isError: isFailedNamed,
            url(args?: Record<string, unknown>): string {
                return rpcRequest(method, routeAt(addressOf(rpc)), args).url
            },
            raw(
                args?: Record<string, unknown>,
                init?: RequestInit,
            ): Promise<Response> {
                const asked = rpcRequest(method, routeAt(addressOf(rpc)), args)
                // `Headers`, not a spread — the caller's may be a `Headers` itself, which spreads empty.
                const headers = new Headers(asked.init.headers)
                for (const [name, value] of new Headers(init?.headers))
                    headers.set(name, value)
                const given: RequestInit = { ...asked.init, ...init, headers }
                // IN PROCESS ON A SERVER, through the app the process holds; OVER THE WIRE elsewhere.
                if (RPC_SERVER.raw !== null)
                    return RPC_SERVER.raw(
                        new Request(
                            new URL(asked.url, IN_PROCESS_ORIGIN),
                            given,
                        ),
                    )
                // 26.24 — a sign-in made raw is still a sign-in.
                return fetch(asked.url, given).then((answer) => {
                    principalRotated(answer, given.method ?? method)
                    return answer
                })
            },
        }) satisfies Gated<unknown>
        const members = rpc as unknown as Record<string, unknown>
        // 20.24 — read as it is asked for: the address is given once the file has loaded (16.88).
        Object.defineProperty(rpc, 'tool', {
            get: (): string | undefined =>
                rpc.address === undefined
                    ? undefined
                    : surfaceName(
                          method,
                          unmounted(rpc.address) ?? rpc.address,
                      ),
        })
        // 7.10, 7.18 — A TRIGGER ON A SERVER REACHES EVERY BROWSER HOLDING WHAT IT NAMES, through the
        // mux (18.3) — 18.37, or the one browser `caller` names. None follow in a browser, where the
        // trigger is the copy's own, and a copy cannot tell whose caller it is (18.38, 26.22).
        for (const name of ['refresh', 'invalidate'] as const)
            members[name] = (
                pattern?: unknown,
                options?: TriggerOptions,
            ): void => {
                const caller = options?.caller
                if (caller !== undefined && !isServer())
                    throw new Error(
                        `abide: \`${name}\` was given a \`caller\` in a browser, which cannot tell whose browser it is. Trigger it from the server. RULEBOOK 18.38.`,
                    )
                faceHere()[name](pattern)
                for (const followers of RPC_SERVER.following)
                    followers.broadcast(rpc, name, pattern, caller)
            }
        // 11.76, 11.77 — A HANDLER IS A MEMO WITH AN ADDRESS (16.6): its owner writes and follows the
        // value for some args as a memo's does — reached past every rung, since the owner is no caller.
        // The handler's own value takes the owner's write as what it produced, and its followers are
        // sent it; a browser's copy takes it as a write to this page's copy, not synced until the
        // server's answer (3.10).
        members.set = (...given: unknown[]): void => {
            const [args, written] = writeOf(given)
            const entry = reach(args) as Reactive<unknown>
            if (!wireCopy) produceInto(entry, written)
            else entry.set(written)
        }
        members.patch = (...given: unknown[]): void => {
            const [args, mutate] = writeOf(given)
            const entry = reach(args) as Reactive<unknown>
            if (!wireCopy) patchInto(entry, mutate as (value: unknown) => void)
            else entry.patch(mutate as (value: unknown) => void)
        }
        members.readable = (args?: unknown): ReadableStream<unknown> =>
            readableOf(reach(args) as Reactive<unknown>)
        members.outbox = (pattern?: unknown): QueuedCall[] =>
            outbox(rpc as never, pattern as Record<string, unknown> | undefined)
        // 21.8, 18.5 — a `GET` over a `global` value, the value it is serving for some args: a cache
        // may hold it for as long as it lives, and the mux may feed it. A request-local one is a
        // forwarder to a value built per request (11.32).
        //
        // READ OFF THE VALUE rather than off the call: behind a rung the call settles to what the
        // value produced, and holds no way back to it. A keyed value is looked up without a reach,
        // so asking starts nothing (11.54).
        if (method === 'GET' && !isForwarder(value))
            GLOBAL_GETS.set(
                rpc,
                keyed
                    ? {
                          key: (args) => keyOf(contract, args),
                          at: (key) =>
                              (
                                  value as { entries: Map<string, unknown> }
                              ).entries.get(key),
                          reach: (args) => reach(args),
                      }
                    : { key: () => '', at: () => value, reach: () => value },
            )
        // 13.15 — the tags its followers carry: a handed value's own, as the build reads them (18.4),
        // or the `GET`'s where it built the value itself.
        if (method === 'GET') {
            const tags =
                value === handler
                    ? DECLARED_TAGS.get(value as object)
                    : (options as { tags?: string[] | undefined } | undefined)
                          ?.tags
            if (tags !== undefined) DECLARED_TAGS.set(rpc, tags)
        }
        return rpc
    }) as Declare<Declared extends 'GET' ? false : true>
}

/** 16.115, 16.116 — the faces a value answers its writes over the wire by, keyed by their verb. */
export const FACES = Symbol('abide.faces')

/** What a function's or a built value's `methods` may name: one verb, its call's. */
const ONE_VERB: readonly Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/** 16.117 — a kind of addressable value whose writes are members of its face. */
type SourceKind = keyof typeof SOURCE_MEMBERS

/** What a source answers its kind by, and the tags a change to it refreshes (`SOURCE_KIND`). */
type SourceBrand = { kind: SourceKind; tags?: readonly string[] | undefined }

/**
 * A value, a function or a source given an address: what `GET` and the four mutations were, one
 * name over the verbs the value answers by (16.111, 16.117), or the ones `methods` names (16.112).
 */
export const rpc: Declare<true> = ((
    value: unknown,
    options?: RpcOptions,
): unknown => {
    // 16.119 — an `rpc` is answered at the one address it was declared at: a server block exporting
    // one, imported from a server file, would answer it twice.
    if (isRpc(value))
        throw new Error(
            "abide: this value is an `rpc` already, answered at its own address. A <script server> exports bare values; import a server file's `rpc` where it is called instead. RULEBOOK 16.119.",
        )
    const { methods, address: _address, columns, ...rest } = options ?? {}
    const brand = brandOf(value)
    if (brand === undefined && typeof value === 'function') {
        if (columns !== undefined) refuseColumns()
        const verbs = calledVerbs(methods)
        // 16.92 — `refreshes` refreshes after a write, which a read-only `rpc` never makes.
        if (rest.refreshes !== undefined && verbs[0] === 'GET')
            throw new Error(
                'abide: an `rpc` answering `GET` alone was declared with `refreshes`, which only a write takes. Refresh from the write that changed the value. RULEBOOK 16.92.',
            )
        const main = declare(verbs[0] as Method)(
            value as never,
            rest as never,
        ) as unknown as { methods: readonly Method[] }
        main.methods = verbs
        return main
    }
    const kind: SourceKind = brand?.kind ?? 'value'
    if (columns !== undefined && kind !== 'table') refuseColumns()
    // 16.117 — what the source writes by: none, for a memo whose entries live a request (11.32), as a
    // write to one would land in a value no later request reads.
    const members: Record<string, Method> =
        kind === 'memo' &&
        isForwarder((value as Record<symbol, unknown>)[KEYED_OF])
            ? {}
            : SOURCE_MEMBERS[kind].members
    const verbs = sourceVerbs(members, methods, SOURCE_MEMBERS[kind].written)
    if (rest.refreshes !== undefined && verbs.length === 1)
        throw new Error(
            'abide: an `rpc` answering `GET` alone was declared with `refreshes`, which only a write takes. Refresh from the write that changed the value. RULEBOOK 16.92.',
        )
    const main = declare('GET')(
        readOf(kind, value, brand, columns) as never,
        readOptions(kind, brand, rest, isPromise(value)) as never,
    ) as unknown as Record<string, unknown> & {
        methods: readonly Method[]
        [FACES]: Partial<Record<Method, unknown>>
        (args?: unknown): unknown
    }
    main.methods = verbs
    // 16.117 — EACH WRITE IS A MEMBER, in process here: the source's own, its rows checked against
    // `columns` for a table. A memo's and a value's are the `Rpc`'s, which write the entry it serves.
    const writer = (member: string): ((...given: unknown[]) => unknown) => {
        if (kind === 'memo' || kind === 'value')
            return main[member] as (...given: unknown[]) => unknown
        if (kind === 'pipe' && member === 'push')
            return (item) => (value as (item: unknown) => unknown)(item)
        const own = (value as Record<string, (...given: unknown[]) => unknown>)[
            member
        ] as (...given: unknown[]) => unknown
        if (columns === undefined) return own
        return (given) => {
            const checked = withinColumns(brand, columns, member, given)
            return isFailed(checked) ? checked : own(checked)
        }
    }
    const faces: Partial<Record<Method, unknown>> = {}
    const shared = facesOptions(rest)
    for (const member in members) {
        const verb = members[member] as Method
        if (!verbs.includes(verb)) continue
        const write = writer(member)
        // One face on both sides: a member answers a promise here as it does on the browser's copy.
        if (kind !== 'memo' && kind !== 'value')
            main[member] = async (...given: unknown[]) => write(...given)
        // 16.116 — WHAT THE BROWSER SENDS IS WHAT THE MEMBER IS GIVEN, and a `patch` handed a function
        // sends the JSON Patch it made, applied here to the value as it stands.
        faces[verb] = declare(verb)(
            (async (args: {
                given?: unknown[] | string | undefined
                ops?: PatchOp[] | string | undefined
            }) => {
                // A `DELETE` carries its args in the query, each member JSON text where no schema
                // read it back (16.9).
                const given = jsonOf(args?.given) ?? []
                const ops = jsonOf(args?.ops)
                const handed =
                    ops === undefined
                        ? given
                        : [...given, (held: unknown) => applyPatch(held, ops)]
                const answered = await write(...handed)
                // A held value's write answers the value it leaves, which the copy then holds.
                if (
                    (kind === 'memo' || kind === 'value') &&
                    (member === 'set' || member === 'patch')
                )
                    return main(
                        member === 'set' && given.length < 2
                            ? undefined
                            : given[0],
                    )
                return answered === undefined ? null : answered
            }) as never,
            shared as never,
        )
    }
    main[FACES] = faces
    return main
}) as Declare<true>

/** `value`, or what it reads as where it is JSON text. */
function jsonOf<Value>(value: Value | string | undefined): Value | undefined {
    return typeof value === 'string' ? (JSON.parse(value) as Value) : value
}

/** 16.117 — the brand a source carries, or a memo's, or `undefined` for a function or a value. */
function brandOf(value: unknown): SourceBrand | undefined {
    if (
        value === null ||
        (typeof value !== 'object' && typeof value !== 'function')
    )
        return undefined
    if ((value as Record<symbol, unknown>)[MEMO_BRAND] === true)
        return { kind: 'memo' }
    return (value as Record<symbol, SourceBrand | undefined>)[SOURCE_KIND]
}

/** 16.111, 16.112 — a function's one verb: `GET`, or the one `methods` names. */
function calledVerbs(
    declared: readonly Method[] | undefined,
): readonly Method[] {
    if (declared === undefined) return ['GET']
    for (const verb of declared)
        if (!ONE_VERB.includes(verb))
            throw new Error(
                `abide: an \`rpc\` was declared with \`methods\` naming ${JSON.stringify(verb)}, which a function does not answer by. RULEBOOK 16.112.`,
            )
    if (declared.length !== 1)
        throw new Error(
            `abide: an \`rpc\` over a function was declared with \`methods\` naming ${declared.length} verbs, and a function is called by one. RULEBOOK 16.112.`,
        )
    return declared
}

/**
 * 16.111, 16.112, 16.117 — the verbs a value or a source answers by: its read, `GET`, then each its
 * members write by where its kind is `written` by default, or the ones `methods` keeps of them — the
 * read always among them.
 */
function sourceVerbs(
    members: Record<string, Method>,
    declared: readonly Method[] | undefined,
    written: boolean,
): readonly Method[] {
    const able: Method[] = ['GET']
    for (const member in members) {
        const verb = members[member] as Method
        if (!able.includes(verb)) able.push(verb)
    }
    if (declared === undefined) return written ? able : ['GET']
    for (const verb of declared)
        if (!able.includes(verb))
            throw new Error(
                `abide: an \`rpc\` was declared with \`methods\` naming ${JSON.stringify(verb)}, which this value answers by only as ${able.join(', ')}. RULEBOOK 16.112, 16.117.`,
            )
    if (!declared.includes('GET'))
        throw new Error(
            'abide: an `rpc` over a value was declared with `methods` leaving out `GET`, which every value is read by. RULEBOOK 16.112.',
        )
    // The read first: it is what a call of the `rpc` sends.
    return ['GET', ...declared.filter((verb) => verb !== 'GET')]
}

/** 16.117 — what a source's `GET` answers: its value, its rows, its status or its entries. */
function readOf(
    kind: SourceKind,
    value: unknown,
    brand: SourceBrand | undefined,
    columns: readonly string[] | undefined,
): unknown {
    if (kind === 'memo') return value
    if (kind === 'job' || kind === 'pipe')
        return (value as { status: unknown }).status
    if (kind === 'table') {
        const rows = value as (match?: unknown) => Record<string, unknown>[]
        return columns === undefined
            ? (match?: Record<string, unknown>) => rows(match)
            : (match?: Record<string, unknown>) => {
                  const checked = withinColumns(brand, columns, 'match', match)
                  return isFailed(checked)
                      ? checked
                      : projected(rows(checked), columns)
              }
    }
    if (kind === 'ledger')
        return async function* (from?: {
            from?: number | undefined
            cursor?: string | undefined
        }): AsyncGenerator<unknown> {
            const read = value as (
                from?: number | { cursor: string },
            ) => ReadableStream<unknown>
            yield* read(
                from?.cursor !== undefined
                    ? { cursor: from.cursor }
                    : from?.from,
            ) as unknown as AsyncIterable<unknown>
        }
    // 16.115 — A VALUE IS THE SERVER'S ONE VALUE, every request reading and writing the same entry:
    // a value per request (11.32) would forget a write the moment its request answered.
    return isPromise(value) ? value : () => value
}

/** 16.115, 16.117 — a source's read's options: one value for the server, a table's name its tag. */
function readOptions(
    kind: SourceKind,
    brand: SourceBrand | undefined,
    options: RpcOptions,
    // A promise is the value form's own (16.1), which takes no source's options (11.81).
    promised: boolean,
): RpcOptions {
    if (kind === 'memo' || kind === 'job' || kind === 'pipe' || promised)
        return options
    const given = options as {
        global?: boolean | undefined
        tags?: string[] | undefined
    }
    const tags =
        brand?.tags === undefined
            ? given.tags
            : [...(given.tags ?? []), ...brand.tags]
    return { ...options, global: given.global ?? true, tags } as RpcOptions
}

function refuseColumns(): never {
    throw new Error(
        'abide: an `rpc` was declared with `columns`, which only a table is read and written by. RULEBOOK 16.118.',
    )
}

/** 16.118 — the rows with only the columns `columns` names. */
function projected(
    rows: readonly Record<string, unknown>[],
    columns: readonly string[],
): Record<string, unknown>[] {
    const kept: Record<string, unknown>[] = []
    for (const row of rows) {
        const picked: Record<string, unknown> = {}
        for (const column of columns)
            if (column in row) picked[column] = row[column]
        kept.push(picked)
    }
    return kept
}

/** 16.118 — `given` refused where it names a column `columns` leaves out, else handed back. */
function withinColumns(
    brand: SourceBrand | undefined,
    columns: readonly string[],
    member: string,
    given: unknown,
): unknown {
    const each = Array.isArray(given) ? given : [given]
    for (const row of each) {
        if (row === undefined || row === null) continue
        for (const column of Object.keys(row as object))
            if (!columns.includes(column))
                return refuse(
                    400,
                    `${brand?.tags?.[0] ?? 'this table'}'s ${member} names ${JSON.stringify(column)}, which its rpc's columns leave out. RULEBOOK 16.118.`,
                )
    }
    return given
}

/** Whether `value` is a promise, which a value `rpc` answers as it settles (16.1). */
function isPromise(value: unknown): boolean {
    return value instanceof Promise
}

/** Whether `value` is an `Rpc` already. */
function isRpc(value: unknown): boolean {
    return typeof value === 'function' && REACH_CALL in value
}

/** The options a value's write faces share with it: who may call them, and how. */
function facesOptions(options: RpcOptions): RpcOptions {
    return {
        description: options.description,
        middleware: options.middleware,
        timeout: options.timeout,
        clients: options.clients,
        crossOrigin: options.crossOrigin,
        maxBodySize: options.maxBodySize,
    }
}

/** The handler's mount address, or a throw naming where one comes from. */
function addressOf(rpc: { address: string | undefined }): string {
    if (rpc.address === undefined)
        throw new Error(
            "abide: this handler has no address yet. A handler is given one where it is mounted: a handler file's default (RULEBOOK 16.2), or a `const` in a <script server> (RULEBOOK 16.70).",
        )
    return rpc.address
}

/**
 * A rung's `ctx.args()`: the args validated on the first ask, and that answer kept after it.
 *
 * 16.17, 16.18, 16.19 — validated against the `args` the value declared on the first ask, and the
 * answer kept for every rung after it. A refusal is thrown, so it leaves the whole onion (16.21)
 * and is answered at its own status.
 */
function argsOnce(
    gate: Schema<unknown> | undefined,
    args: unknown,
): () => unknown {
    let asked = false
    let answer: unknown
    return () => {
        if (asked) return answer
        // Validated BEFORE it is marked asked, so a rung that caught the refusal and asks again is
        // refused again rather than handed nothing.
        answer = gate === undefined ? args : checkArgs(gate, args)
        asked = true
        return answer
    }
}

/**
 * What a handler's run answered, with its `refreshes` run once it is known not to be a refusal.
 *
 * 16.90 — before the answer settles, so nothing the call's caller does next reads from before the
 * write. 16.91 — a stream's at its close, where the write is whole, and not where it fails: a
 * failure is thrown out of `yield*` past the refresh.
 */
async function answerThenRefresh(
    answer: Promise<unknown>,
    refresh: () => void | Promise<void>,
    named: () => string,
): Promise<unknown> {
    const answered = await answer
    if (isFailed(answered)) return answered
    if (isAsyncIterable(answered))
        return refreshedAtClose(answered, refresh, named)
    const refreshing = refreshOrWarn(refresh, named)
    if (refreshing !== undefined) await refreshing
    return answered
}

async function* refreshedAtClose(
    chunks: AsyncIterable<unknown>,
    refresh: () => void | Promise<void>,
    named: () => string,
): AsyncGenerator<unknown> {
    yield* chunks
    const refreshing = refreshOrWarn(refresh, named)
    if (refreshing !== undefined) await refreshing
}

const REFRESHES_LOG = namedLogger('abide:reactive')

/**
 * 16.102 — A FAILING `refreshes` LEAVES THE ANSWER AS THE HANDLER MADE IT: the write has landed, and
 * a refusal or a 500 here is a write a retrying client makes twice. Warned once instead.
 */
function refreshOrWarn(
    refresh: () => void | Promise<void>,
    named: () => string,
): void | Promise<void> {
    const warn = (failure: unknown): void =>
        REFRESHES_LOG.warning(
            `${named()}: its refreshes failed, and the write is answered as it returned.`,
            failure,
        )
    try {
        const refreshing = refresh()
        if (refreshing !== undefined) return refreshing.catch(warn)
    } catch (failure) {
        warn(failure)
    }
}

/**
 * 16.89 — `refresh` over each entry `refreshes` named, its tags as one selection, once a promise of
 * them settles: 16.101 runs the function in the call's scope, so it may `await principal.resolved`
 * for whose entry the write changed.
 */
function refreshEach(
    refreshed: Refreshed | PromiseLike<Refreshed>,
): void | Promise<void> {
    if (isThenable(refreshed))
        return Promise.resolve(refreshed).then(refreshEach)
    // 16.103 — one entry failing leaves the rest to refresh; the first failure is what 16.102 warns.
    let tags: string[] | undefined
    let failed: { failure: unknown } | undefined
    for (const entry of refreshed as Refreshed) {
        if (typeof entry === 'string') {
            ;(tags ??= []).push(entry)
            continue
        }
        try {
            if (Array.isArray(entry))
                entry[0].refresh(entry[1] as never, entry[2])
            else refresh(entry as Selection)
        } catch (failure) {
            failed ??= { failure }
        }
    }
    if (tags !== undefined) refresh({ tags })
    if (failed !== undefined) throw failed.failure
}

/** The member a browser's copy is told it streams through, since its body is the wire's (16.32). */
export const STREAMING_COPY = Symbol('abide.streamingCopy')

/** The member a browser's copy is marked through: an owner's write to it is this page's (11.76). */
export const WIRE_COPY = Symbol('abide.wireCopy')

/** The handler's value for `args`, as `rpc` reached it: what abide's own callers hold (`REACH_CALL`). */
export function reachOf(
    rpc: unknown,
    args?: unknown,
    options?: CallOptions,
): unknown {
    return (
        rpc as {
            [REACH_CALL]: (args?: unknown, options?: CallOptions) => unknown
        }
    )[REACH_CALL](args, options)
}
