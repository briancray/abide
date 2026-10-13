// `GET` and the four mutations: a handler given an address (16.2). The IN-PROCESS arm is what a
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

import { type Failed, isFailedNamed } from './Failed.ts'
import { filledSegments } from './filledPath.ts'
import { GLOBAL_GETS } from './GLOBAL_GETS.ts'
import { compose, type Middleware } from './Middleware.ts'
import { principalRotated } from './principalRotated.ts'
import { RPC_SERVER } from './RPC_SERVER.ts'
import {
    contractOf,
    type Gated,
    gateOf,
    keyOf,
    normalized,
} from './reactive/argsContract.ts'
import { callLoad } from './reactive/callLoad.ts'
import {
    type AdoptedFailures,
    type AdoptedProduced,
    type ChunkOf,
    chunksOfStream,
    handlerValue,
    isKeyed,
    type Kept,
    type Keyed,
    type OptionalParameter,
    type Reactive,
    type Refusals,
    reactive,
    type Shaping,
    STREAMING,
    type Streams,
    streamingOrSettled,
} from './reactive/index.ts'
import { MUTATION } from './reactive/MUTATION.ts'
import { SELECTION_MEMBERS } from './reactive/SELECTION_MEMBERS.ts'
import { isForwarder } from './reactive/scoped.ts'
import { checkArgs } from './refuse.ts'
import { parseRoutePattern, type Segment } from './routePattern.ts'
import { pathRefusal, rpcRequest } from './rpcRequest.ts'
import type { Schema } from './Schema.ts'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** What a call is handed beside its args (16.48). */
export type CallOptions = { signal?: AbortSignal }

/**
 * A declared handler: callable for its `Reactive`, with the handler's own members and its mount.
 *
 * 16.3 — the call hands back the handler's own `Reactive`; the members below are the handler's,
 * passed through.
 *
 * 16.8 — AND ITS FAILURES CARRY THE TRANSPORT'S `HttpError`, which no handler declares and every
 * call can be answered with: a body over `maxBodySize` (413), a closed `crossOrigin` (403), a
 * `timeout` (504), and any failure status whose body was not a `Failed`, rebuilt by `answered`.
 */
export type Rpc<Value, Args, Failures = never, Produced = Value> = ((
    ...args: undefined extends Args
        ? [args?: Args, options?: CallOptions]
        : [args: Args, options?: CallOptions]
) => Reactive<
    Value,
    Value,
    Failures | Failed<'HttpError', undefined>,
    Produced
>) & {
    method: Method
    description: string | undefined
    /**
     * The handler's own probe, narrowed by a pattern where the handler is keyed.
     *
     * 13.4, 13.12 — the handler's own face. An `Rpc` is a `Selection` by having it (13.1).
     */
    busy(pattern?: Partial<Args>): boolean
    ready(pattern?: Partial<Args>): boolean
    refresh(pattern?: Partial<Args>): void
    invalidate(pattern?: Partial<Args>): void
    isError<Name extends string>(
        error: unknown,
        name: Name,
    ): error is Extract<
        Failures | Failed<'HttpError', undefined>,
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
    /** Where the handler is mounted, stamped by whoever mounted it — `undefined` until then. */
    address: string | undefined
    keyed: boolean
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

/** Which generated surfaces carry a handler (20.1). */
export type Clients = {
    ui?: boolean
    mcp?: boolean
    cli?: boolean
    openapi?: boolean
}

export type RpcContext<Args = unknown> = { request: Request; args: () => Args }

/**
 * The context key holding the args as sent.
 *
 * 11.26 — THE ARGS AS SENT, carried on the context under a key no rung spells, so the reach at the
 * onion's center keys the value by them rather than by what the gate made of them.
 */
const SENT: unique symbol = Symbol('abide.sent')

export type RpcOptions<Args = unknown> = {
    description?: string
    middleware?: Middleware<RpcContext<Args>, unknown>[]
    timeout?: number
    clients?: Clients
    crossOrigin?: boolean | string[]
    maxBodySize?: number
}

/**
 * A handler `declare` builds the value of: a plain function or a value, which no `Reactive` or
 * `Keyed` is.
 *
 * Told by a member both carry and neither of those does. Without it a value handed in with a
 * value's option — `GET(reactive(f), { ttl })` — fell through its own arm to a plain one, and the
 * option was dropped by a value that had already been built.
 */
export type Plain = { invalidate?: never }

// The value arm's handler: anything but a function, which is a body, or a `Reactive` or `Keyed`,
// which has decided its own options. Unguarded, the arm won overload resolution's subtype pass over
// every function arm, whose `& Plain` only passes assignability. The guard is the whole parameter
// because `& Plain` kept `GET(0)` the literal `0`, and a bound of `Plain` refuses every primitive.
type Held<Accepted> = Accepted extends
    | ((...given: never[]) => unknown)
    | { invalidate: unknown }
    ? never
    : Accepted | PromiseLike<Accepted>

/**
 * The signature `GET` and the four mutations share: a handler in, its `Rpc` out.
 *
 * ONE CALL SIGNATURE PER HANDLER ARM, shared by all five names. The two `reactive` arms come first:
 * a `Reactive` is itself a `() => Stored`, so the plain-function arm would otherwise swallow it
 * and type the `Rpc` as holding the value's own getter. The plain arms are `reactive`'s own
 * overloads, in its order and for its reason, and take its options beside the address's (16.6) —
 * which is why a value handed in takes the address's alone: it has decided its own.
 */
type Declare = {
    <Stored, Args, Accepted, Failures, Produced>(
        handler: Keyed<Stored, Args, Accepted, Failures, Produced>,
        options?: RpcOptions<Args>,
    ): Rpc<Stored, Args, Failures, Produced>
    <Stored, Accepted, Failures, Produced>(
        handler: Reactive<Stored, Accepted, Failures, Produced>,
        options?: RpcOptions<undefined>,
    ): Rpc<Stored, undefined, Failures, Produced>
    // 11.2 — a stream whose parameter is optional is keyed, for `reactive`'s reason.
    <
        Body extends (args?: never) => unknown,
        Shaped = ChunkOf<Body>[],
        Gate = Schema<ChunkOf<Body>[]>,
        ArgsGate = Schema<Parameters<Body>[0]>,
    >(
        handler: Body & OptionalParameter<Body> & Streams<Body> & Plain,
        options?: Shaping<
            ChunkOf<Body>[],
            Shaped,
            Parameters<Body>[0],
            Gate,
            ArgsGate
        > &
            RpcOptions<Parameters<Body>[0]>,
    ): Rpc<
        Kept<Shaped>,
        Parameters<Body>[0],
        Refusals<Shaped, Gate, ChunkOf<Body>[], ArgsGate, Parameters<Body>[0]>,
        ChunkOf<Body>
    >
    <Chunk, Shaped = Chunk[], Gate = Schema<Chunk[]>>(
        handler: (() =>
            | AsyncGenerator<Chunk>
            | Promise<AsyncGenerator<Chunk>>) &
            Plain,
        options?: Shaping<Chunk[], Shaped, never, Gate> & RpcOptions<undefined>,
    ): Rpc<Kept<Shaped>, undefined, Refusals<Shaped, Gate, Chunk[]>, Chunk>
    <
        Chunk,
        Args,
        Shaped = Chunk[],
        Gate = Schema<Chunk[]>,
        ArgsGate = Schema<Args>,
    >(
        handler: ((
            args: Args,
        ) => AsyncGenerator<Chunk> | Promise<AsyncGenerator<Chunk>>) &
            Plain,
        options?: Shaping<Chunk[], Shaped, Args, Gate, ArgsGate> &
            RpcOptions<Args>,
    ): Rpc<
        Kept<Shaped>,
        Args,
        Refusals<Shaped, Gate, Chunk[], ArgsGate, Args>,
        Chunk
    >
    // 11.2 — an optional parameter is keyed, and ahead of the arm below for `reactive`'s reason.
    <
        Body extends (args?: never) => unknown,
        Shaped = Awaited<ReturnType<Body>>,
        Gate = Schema<Awaited<ReturnType<Body>>>,
        ArgsGate = Schema<Parameters<Body>[0]>,
    >(
        handler: Body & OptionalParameter<Body> & Plain,
        options?: Shaping<
            Awaited<ReturnType<Body>>,
            Shaped,
            Parameters<Body>[0],
            Gate,
            ArgsGate
        > &
            RpcOptions<Parameters<Body>[0]>,
    ): Rpc<
        Kept<Shaped>,
        Parameters<Body>[0],
        | AdoptedFailures<ReturnType<Body>>
        | Refusals<
              Shaped,
              Gate,
              Awaited<ReturnType<Body>>,
              ArgsGate,
              Parameters<Body>[0]
          >,
        AdoptedProduced<ReturnType<Body>, Kept<Shaped>>
    >
    <Computed, Shaped = Awaited<Computed>, Gate = Schema<Awaited<Computed>>>(
        handler: (() => Computed) & Plain,
        options?: Shaping<Awaited<Computed>, Shaped, never, Gate> &
            RpcOptions<undefined>,
    ): Rpc<
        Kept<Shaped>,
        undefined,
        AdoptedFailures<Computed> | Refusals<Shaped, Gate, Awaited<Computed>>,
        AdoptedProduced<Computed, Kept<Shaped>>
    >
    <
        Computed,
        Args,
        Shaped = Awaited<Computed>,
        Gate = Schema<Awaited<Computed>>,
        ArgsGate = Schema<Args>,
    >(
        handler: ((args: Args) => Computed) & Plain,
        options?: Shaping<Awaited<Computed>, Shaped, Args, Gate, ArgsGate> &
            RpcOptions<Args>,
    ): Rpc<
        Kept<Shaped>,
        Args,
        | AdoptedFailures<Computed>
        | Refusals<Shaped, Gate, Awaited<Computed>, ArgsGate, Args>,
        AdoptedProduced<Computed, Kept<Shaped>>
    >
    // 16.1 — a value, `reactive`'s value overload given an address. Last, so a function is a body.
    <Accepted, Shaped = Accepted, Gate = Schema<Accepted>>(
        handler: Held<Accepted>,
        options?: Shaping<Accepted, Shaped, never, Gate> &
            RpcOptions<undefined>,
    ): Rpc<Kept<Shaped>, undefined, Refusals<Shaped, Gate, Accepted>>
}

/** Builds the handler declarer for one method — what `GET`, `POST` and the rest are. */
export function declare(method: Method): Declare {
    return ((handler: unknown, options?: RpcOptions): unknown => {
        // 16.6, and 16.7's `ttl` of 0 on a mutation: each call is a write, so nothing a previous
        // call produced is served to the next one. 13.16 — and marked, so a sweep never sends it again.
        const cacheOptions =
            method === 'GET' ? undefined : { ttl: 0, [MUTATION]: true as const }
        // 16.6 — A PLAIN FUNCTION'S VALUE IS BUILT WITH THE WHOLE OPTIONS OBJECT: `reactive` reads
        // the keys that are its own and passes over the address's, so nothing splits them. 16.7's
        // `ttl` is a default the handler's own overrides.
        const value = handlerValue(
            handler,
            cacheOptions === undefined
                ? options
                : { ...cacheOptions, ...options },
        )
        const keyed = isKeyed(value)
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
        const rungs = options?.middleware ?? []
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
        const onion =
            rungs.length === 0
                ? null
                : compose(rungs, async (ctx: RpcContext) => {
                      const reached = reach(argsOf(ctx))
                      const started = performance.now()
                      try {
                          const settled = await streamingOrSettled(reached)
                          return settled === STREAMING
                              ? chunksOfStream(reached)
                              : settled
                      } finally {
                          RPC_SERVER.handled?.(rpc, performance.now() - started)
                      }
                  })
        const wrapped =
            onion === null
                ? null
                : reactive(
                      (args: unknown) => onion(contextOf(args)),
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
        // reach the same refusal, and there is no request for the render to report. The route is
        // parsed once per address, which is stamped after the declaration (16.10).
        let routed: string | undefined
        let routeSegments: Segment[] | null = null
        const call = (given?: unknown, options?: CallOptions): unknown => {
            const args = normalized(contract, given)
            const address = rpc.address
            if (address !== routed) {
                routed = address
                routeSegments =
                    address?.includes('[') === true
                        ? parseRoutePattern(address)
                        : null
            }
            if (routeSegments !== null) {
                try {
                    filledSegments(
                        routeSegments,
                        (args ?? {}) as Record<string, unknown>,
                        routed as string,
                        pathRefusal,
                    )
                } catch (refused) {
                    return reactive(() => refused)
                }
            }
            const reached = callLoad(
                reachThrough,
                args,
                options?.signal,
                rpc.timeout ?? RPC_SERVER.timeout(),
            )
            RPC_SERVER.reached?.(rpc, args, reached)
            return reached
        }
        // THE HANDLER'S OWN MEMBERS, handed the pattern. A `Keyed` narrows by it and a `Reactive`'s
        // take no argument, so one spelling serves both arms and neither is a second mechanism.
        const face = value as Record<
            (typeof SELECTION_MEMBERS)[number],
            (pattern?: unknown) => unknown
        >
        const rpc = Object.assign(call, contract, {
            method,
            description: options?.description,
            address: undefined as string | undefined,
            // 20.9 — which arm the handler took, which is what MCP lists it by.
            keyed,
            timeout: options?.timeout,
            crossOrigin: options?.crossOrigin ?? false,
            maxBodySize: options?.maxBodySize,
            clients: options?.clients ?? {},
            guarded: rungs.length > 0,
            isError: isFailedNamed,
            url(args?: Record<string, unknown>): string {
                return rpcRequest(method, addressOf(rpc), args).url
            },
            raw(
                args?: Record<string, unknown>,
                init?: RequestInit,
            ): Promise<Response> {
                const asked = rpcRequest(method, addressOf(rpc), args)
                // `Headers`, not a spread — the caller's may be a `Headers` itself, which spreads empty.
                const headers = new Headers(asked.init.headers)
                for (const [name, value] of new Headers(init?.headers))
                    headers.set(name, value)
                const given: RequestInit = { ...asked.init, ...init, headers }
                // IN PROCESS ON A SERVER, through the app the process holds; OVER THE WIRE elsewhere.
                if (RPC_SERVER.raw !== null)
                    return RPC_SERVER.raw(
                        new Request(
                            new URL(asked.url, 'http://app.internal'),
                            given,
                        ),
                    )
                // 26.24 — a sign-in made raw is still a sign-in.
                return fetch(asked.url, given).then((answer) => {
                    principalRotated(answer)
                    return answer
                })
            },
        }) satisfies Gated<unknown>
        const members = rpc as unknown as Record<string, unknown>
        // 7.10, 7.18 — A TRIGGER ON A SERVER REACHES EVERY BROWSER HOLDING WHAT IT NAMES, through the
        // mux (18.3). `null` in a browser, where the trigger is the copy's own.
        for (const name of SELECTION_MEMBERS)
            members[name] =
                name === 'invalidate' || name === 'refresh'
                    ? (pattern?: unknown): unknown => {
                          const done = face[name](pattern)
                          RPC_SERVER.broadcast?.(rpc, name, pattern)
                          return done
                      }
                    : (pattern?: unknown): unknown => face[name](pattern)
        // 21.8, 18.5 — a `GET` over a `global` value, the value it is serving for some args: a cache
        // may hold it for as long as it lives, and the mux may feed it. A request-local one is a
        // forwarder to a value built per request (11.32).
        //
        // READ OFF THE VALUE rather than off the call: behind a rung the call settles to what the
        // value produced, and holds no way back to it. A keyed value is looked up without a reach,
        // so asking starts nothing (11.55).
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
                      }
                    : { key: () => '', at: () => value },
            )
        return rpc
    }) as Declare
}

export const GET: Declare = declare('GET')
export const POST: Declare = declare('POST')
export const PUT: Declare = declare('PUT')
export const PATCH: Declare = declare('PATCH')
export const DELETE: Declare = declare('DELETE')

/** The handler's mount address, or a throw naming where one comes from. */
function addressOf(rpc: { address: string | undefined }): string {
    if (rpc.address === undefined)
        throw new Error(
            "abide: this handler has no address yet. A handler is given one where it is mounted: a handler file's default (16.2), or a `const` in a <script server> (16.70).",
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
