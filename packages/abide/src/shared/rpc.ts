// `GET` and the four mutations: a handler given an address (16.2). The IN-PROCESS arm is what a
// server-side caller, a page rendering on the server and a test all reach; the WIRE arm is what a
// browser gets in its place (16.29, `#ui/wire.ts`) — and it is `declare` over a body that fetches,
// which is why this module is in the seam both reach rather than in the server's.
//
// A HANDLER IS A `reactive` (16.1), so an `Rpc` is not a second kind of value: the call hands back
// the handler's own `Reactive` (16.3), and every probe, trigger and failure on it is the reactive
// core's — the `Rpc`'s own `busy`, `ready`, `refresh` and `invalidate` are the handler's, passed
// through. What this file adds is the normalising — a plain function becomes the `reactive` it
// would have been (16.6) — and the method.
//
// A HANDLER DECLARING `middleware` IS REACHED THROUGH ITS RUNGS (16.12), in process as over the wire:
// the call hands back a value whose body runs the onion once per args, per request, over the
// handler's own. NOT HERE YET: 16.8's publish into a value with no producer; 16.7's `ttl` default on
// a `reactive` built before it reached a mutation; and a streaming handler behind rungs, whose
// chunks the onion collects rather than forwards.

import { isFailedNamed } from './Failed.ts'
import { compose, type Middleware } from './Middleware.ts'
import { RPC_SERVER } from './RPC_SERVER.ts'
import { ARGS_GATE } from './reactive/ARGS_GATE.ts'
import {
    type AdoptedFailures,
    type AdoptedProduced,
    isKeyed,
    isReactive,
    type Kept,
    type Keyed,
    type Reactive,
    type Refused,
    reactive,
} from './reactive/index.ts'
import { SELECTION_MEMBERS } from './reactive/SELECTION_MEMBERS.ts'
import type { Gated } from './reactive/Keyed.ts'
import { checkArgs } from './refuse.ts'
import { rpcRequest } from './rpcRequest.ts'
import type { Schema } from './Schema.ts'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type Rpc<Value, Args, Failures = never, Produced = Value> = ((
    ...args: undefined extends Args ? [args?: Args] : [args: Args]
) => Reactive<Value, Value, Failures, Produced>) & {
    method: Method
    description: string | undefined
    // 13.4, 13.12 — the handler's own face, narrowed by a pattern where the handler is keyed. An
    // `Rpc` is a `Selection` by having it (13.1).
    busy(pattern?: Partial<Args>): boolean
    ready(pattern?: Partial<Args>): boolean
    refresh(pattern?: Partial<Args>): void
    invalidate(pattern?: Partial<Args>): void
    isError<Name extends string>(
        error: unknown,
        name: Name,
    ): error is Extract<Failures, { name: Name }>
    // 16.10, 16.11 — the address, resolved against the mount; a mutation's takes no args.
    url(...args: undefined extends Args ? [args?: Args] : [args: Args]): string
    // 16.44 — the same call, handed back as the response.
    raw(args?: Args, init?: RequestInit): Promise<Response>
    // Where the handler is mounted, stamped by whoever mounted it — `undefined` until then.
    address: string | undefined
    keyed: boolean
    timeout: number | undefined
    crossOrigin: boolean | string[]
    maxBodySize: number | undefined
    clients: Clients
}

// 20.1 — which generated surfaces carry a handler.
export type Clients = {
    ui?: boolean
    mcp?: boolean
    cli?: boolean
    openapi?: boolean
}

export type RpcContext<Args = unknown> = { request: Request; args: () => Args }

// 11.26 — THE ARGS AS SENT, carried on the context under a key no rung spells, so the reach at the
// onion's centre keys the value by them rather than by what the gate made of them.
const SENT: unique symbol = Symbol('abide.sent')

export type RpcOptions<Args = unknown> = {
    description?: string
    middleware?: Middleware<RpcContext<Args>, unknown>[]
    timeout?: number
    clients?: Clients
    crossOrigin?: boolean | string[]
    maxBodySize?: number
}

// ONE CALL SIGNATURE PER HANDLER ARM, shared by all five names. The two `reactive` arms come first:
// a `Reactive` is itself a `() => Stored`, so the plain-function arm would otherwise swallow it
// and type the `Rpc` as holding the value's own getter. The four plain arms are `reactive`'s own
// overloads, in its order and for its reason (16.6).
type Declare = {
    <Stored, Args, Accepted, Failures, Produced>(
        handler: Keyed<Stored, Args, Accepted, Failures, Produced>,
        options?: RpcOptions<Args>,
    ): Rpc<Stored, Args, Failures, Produced>
    <Stored, Accepted, Failures, Produced>(
        handler: Reactive<Stored, Accepted, Failures, Produced>,
        options?: RpcOptions<undefined>,
    ): Rpc<Stored, undefined, Failures, Produced>
    <Chunk>(
        handler: () => AsyncGenerator<Chunk>,
        options?: RpcOptions<undefined>,
    ): Rpc<Chunk[], undefined, never, Chunk>
    <Chunk, Args>(
        handler: (args: Args) => AsyncGenerator<Chunk>,
        options?: RpcOptions<Args>,
    ): Rpc<Chunk[], Args, never, Chunk>
    <Computed>(
        handler: () => Computed,
        options?: RpcOptions<undefined>,
    ): Rpc<
        Kept<Awaited<Computed>>,
        undefined,
        AdoptedFailures<Computed> | Refused<Awaited<Computed>>,
        AdoptedProduced<Computed, Kept<Awaited<Computed>>>
    >
    <Computed, Args>(
        handler: (args: Args) => Computed,
        options?: RpcOptions<Args>,
    ): Rpc<
        Kept<Awaited<Computed>>,
        Args,
        AdoptedFailures<Computed> | Refused<Awaited<Computed>>,
        AdoptedProduced<Computed, Kept<Awaited<Computed>>>
    >
}

export function declare(method: Method): Declare {
    return ((handler: unknown, options?: RpcOptions): unknown => {
        // 16.6, and 16.7's `ttl` of 0 on a mutation: each call is a write, so nothing a previous
        // call produced is served to the next one.
        const cacheOptions = method === 'GET' ? undefined : { ttl: 0 }
        // 16.5 — THE ARM IS READ OFF A BRAND. A `Keyed` and a one-parameter plain function have
        // the same shape, and only the first has already decided its own keying.
        const value =
            isReactive(handler) || isKeyed(handler)
                ? handler
                : reactive(handler as (args: never) => unknown, cacheOptions)
        const keyed = isKeyed(value)
        const gate = keyed ? value[ARGS_GATE] : undefined
        const reach = (args?: unknown): unknown =>
            keyed ? (value as (args: unknown) => unknown)(args) : value
        // 16.12, 16.13 — THE RUNGS, IN REGISTRATION ORDER, around the reach. Built once, at the
        // declaration (16.15); a value keyed by args, so a second call with the same args in one
        // request joins the first (1.8) and a server files one per request (11.32).
        const rungs = options?.middleware ?? []
        const onion =
            rungs.length === 0
                ? null
                : // A rung that handed `next` a context of its own making chose those args.
                  compose(rungs, async (ctx: RpcContext) =>
                      reach(
                          SENT in ctx
                              ? (ctx as { [SENT]: unknown })[SENT]
                              : ctx.args(),
                      ),
                  )
        const wrapped =
            onion === null
                ? null
                : reactive(
                      (args: unknown) =>
                          onion({
                              request: RPC_SERVER.request(),
                              args: argsOnce(gate, args),
                              [SENT]: args,
                          } as RpcContext),
                      cacheOptions,
                  )
        // 16.3 — the handler's own `Reactive`. A `Keyed` reaches its entry, which is 1.7's start
        // and 1.8's join; an unkeyed value has one entry and the call is the reach of it.
        //
        // 41.13 — AND REPORTED, where the call is made in a page's render: the browser's own call for
        // this handler and these args is then answered from what this one reached, rather than by
        // running the handler again. In a browser nothing fills the slot, so the report is one load
        // of a `null`.
        const call = (args?: unknown): unknown => {
            const reached =
                wrapped === null
                    ? reach(args)
                    : (wrapped as (args: unknown) => unknown)(args)
            RPC_SERVER.reached?.(rpc, args, reached)
            return reached
        }
        // THE HANDLER'S OWN MEMBERS, handed the pattern. A `Keyed` narrows by it and a `Reactive`'s
        // take no argument, so one spelling serves both arms and neither is a second mechanism.
        const face = value as Record<
            (typeof SELECTION_MEMBERS)[number],
            (pattern?: unknown) => unknown
        >
        const rpc = Object.assign(call, {
            method,
            description: options?.description,
            address: undefined as string | undefined,
            // 20.9 — which arm the handler took, which is what MCP lists it by.
            keyed,
            timeout: options?.timeout,
            crossOrigin: options?.crossOrigin ?? false,
            maxBodySize: options?.maxBodySize,
            clients: options?.clients ?? {},
            // 19.8 — the handler's `args` gate, on the `Rpc` too, for the wire to coerce by.
            [ARGS_GATE]: gate,
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
                return fetch(asked.url, given)
            },
        }) satisfies Gated<unknown>
        const members = rpc as unknown as Record<string, unknown>
        for (const name of SELECTION_MEMBERS)
            members[name] = (pattern?: unknown): unknown => face[name](pattern)
        return rpc
    }) as Declare
}

export const GET: Declare = declare('GET')
export const POST: Declare = declare('POST')
export const PUT: Declare = declare('PUT')
export const PATCH: Declare = declare('PATCH')
export const DELETE: Declare = declare('DELETE')

function addressOf(rpc: { address: string | undefined }): string {
    if (rpc.address === undefined)
        throw new Error(
            'abide: this handler has no address yet. A handler is given one where it is mounted, under src/server/rpc (16.2).',
        )
    return rpc.address
}

// 16.18, 16.19, 16.20 — `ctx.args()`: validated against the `args` the value declared on the first
// ask, and the answer kept for every rung after it. A refusal is thrown, so it leaves the whole
// onion (16.22) and is answered at its own status.
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
