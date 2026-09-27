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
// a `reactive` built before it reached a mutation; and an app's own streaming `Reactive` behind
// rungs, whose chunks the onion collects rather than forwards (a generator handler's it forwards).

import { isFailed, isFailedNamed } from './Failed.ts'
import { GLOBAL_GETS } from './GLOBAL_GETS.ts'
import { LOAD_SIGNAL } from './LOAD_SIGNAL.ts'
import { compose, type Middleware } from './Middleware.ts'
import { RPC_SERVER } from './RPC_SERVER.ts'
import { ARGS_GATE } from './reactive/ARGS_GATE.ts'
import { canonicalKey } from './reactive/canonicalKey.ts'
import {
    type AdoptedFailures,
    type AdoptedProduced,
    abandonLoad,
    isKeyed,
    isReactive,
    isStreamBody,
    isStreaming,
    loadOf,
    type Kept,
    type Keyed,
    type Reactive,
    type Refused,
    reactive,
} from './reactive/index.ts'
import type { Gated } from './reactive/Keyed.ts'
import { SELECTION_MEMBERS } from './reactive/SELECTION_MEMBERS.ts'
import { isForwarder } from './reactive/scoped.ts'
import { aborted, checkArgs, refuse } from './refuse.ts'
import { rpcRequest } from './rpcRequest.ts'
import type { Schema } from './Schema.ts'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// 16.53 — what a call is handed beside its args.
export type CallOptions = { signal?: AbortSignal }

export type Rpc<Value, Args, Failures = never, Produced = Value> = ((
    ...args: undefined extends Args
        ? [args?: Args, options?: CallOptions]
        : [args: Args, options?: CallOptions]
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
    // 18.23 — whether the handler declared rungs, which a value pushed over the mux would not pass.
    guarded: boolean
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
        // A rung that handed `next` a context of its own making chose those args.
        const argsOf = (ctx: RpcContext): unknown =>
            SENT in ctx ? (ctx as { [SENT]: unknown })[SENT] : ctx.args()
        const contextOf = (args: unknown): RpcContext =>
            ({
                request: RPC_SERVER.request(),
                args: argsOnce(gate, args),
                [SENT]: args,
            }) as RpcContext
        // 16.33 BEHIND RUNGS — A STREAMING HANDLER'S CHUNKS ARE FORWARDED, not collected. The centre
        // of the onion is an async function, and a `Reactive` is thenable (1.4), so handing the
        // reached value out through it settled it — waited out the whole stream and answered the
        // accumulation once it closed. A generator is not thenable: the centre hands back the
        // handler's own, the rungs decide whether it runs, and the value the call reaches is a
        // streaming producer of its own that yields what that generator does. A refusal a rung
        // answers with is thrown, which is how a stream refuses.
        //
        // AN APP'S OWN STREAMING `Reactive` BEHIND RUNGS IS STILL COLLECTED: there the handler is
        // the value rather than the generator, and nothing reaches its chunks as they land.
        const streams =
            !isReactive(handler) &&
            !isKeyed(handler) &&
            isStreamBody(handler as (args: never) => unknown)
        const onion =
            rungs.length === 0
                ? null
                : compose(rungs, async (ctx: RpcContext) =>
                      streams
                          ? (handler as (args: unknown) => unknown)(argsOf(ctx))
                          : reach(argsOf(ctx)),
                  )
        const wrapped =
            onion === null
                ? null
                : streams
                  ? reactive(async function* (args: unknown) {
                        const reached = await onion(contextOf(args))
                        if (isFailed(reached)) throw reached
                        yield* reached as AsyncIterable<unknown>
                    }, cacheOptions)
                  : reactive(
                        (args: unknown) => onion(contextOf(args)),
                        cacheOptions,
                    )
        // 16.3 — the handler's own `Reactive`. A `Keyed` reaches its entry, which is 1.7's start
        // and 1.8's join; an unkeyed value has one entry and the call is the reach of it.
        //
        // 41.13 — AND REPORTED, where the call is made in a page's render: the browser's own call for
        // this handler and these args is then answered from what this one reached, rather than by
        // running the handler again. In a browser nothing fills the slot, so the report is one load
        // of a `null`.
        const call = (args?: unknown, options?: CallOptions): unknown => {
            const signal = options?.signal
            // A load this call starts may be ended by it, so its transport is handed a signal of
            // the load's own to end the request with (16.54) — the caller's is only one vote.
            const ending =
                signal === undefined ? undefined : new AbortController()
            LOAD_SIGNAL.current = ending?.signal
            let reached: unknown
            try {
                reached =
                    wrapped === null
                        ? reach(args)
                        : (wrapped as (args: unknown) => unknown)(args)
                // 16.67 — the callers of an aborted load stopped waiting, and this one has not.
                if (
                    ABANDONED.delete(reached as object) &&
                    loadOf(reached) === undefined
                )
                    (reached as { refresh(): void }).refresh()
            } finally {
                LOAD_SIGNAL.current = undefined
            }
            holdLoad(reached, signal, ending)
            timeLoad(reached, rpc.timeout ?? RPC_SERVER.timeout())
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
            guarded: rungs.length > 0,
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
        // 7.10, 7.18 — A TRIGGER ON A SERVER REACHES EVERY BROWSER HOLDING WHAT IT NAMES, through the
        // mux (18.17). `null` in a browser, where the trigger is the copy's own.
        for (const name of SELECTION_MEMBERS)
            members[name] =
                name === 'invalidate' || name === 'refresh'
                    ? (pattern?: unknown): unknown => {
                          const done = face[name](pattern)
                          RPC_SERVER.broadcast?.(rpc, name, pattern)
                          return done
                      }
                    : (pattern?: unknown): unknown => face[name](pattern)
        // 21.8, 18.20 — a `GET` over a `global` value, the value it is serving for some args: a cache
        // may hold it for as long as it lives, and the mux may feed it. A request-local one is a
        // forwarder to a value built per request (11.32).
        //
        // READ OFF THE VALUE rather than off the call: behind a rung the call settles to what the
        // value produced, and holds no way back to it. A keyed value is looked up without a reach,
        // so asking starts nothing (11.56).
        if (method === 'GET' && !isForwarder(value))
            GLOBAL_GETS.set(rpc, (args: unknown): unknown =>
                keyed
                    ? (value as { entries: Map<string, unknown> }).entries.get(
                          canonicalKey(args),
                      )
                    : value,
            )
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
// 16.53 — WHO IS WAITING ON A LOAD. Calls with the same args join one load (1.8), so one caller's
// signal is not the load's to end: a call with no signal pins it, and a load no call pinned ends
// once every signal handed to it has aborted. Per value and replaced per load, so a refresh starts
// the count again.
type Hold = {
    load: number
    pinned: boolean
    signals: Set<AbortSignal>
    ending: AbortController | undefined
    release: () => void
}

const HOLDS = new WeakMap<object, Hold>()

// The values whose last load 16.53 ended, until a call reaches one again.
const ABANDONED = new WeakSet<object>()

function holdLoad(
    reached: unknown,
    signal: AbortSignal | undefined,
    ending: AbortController | undefined,
): void {
    if (!isReactive(reached)) return
    const load = loadOf(reached)
    // Landed as it was reached, or nothing in flight: there is no load to end.
    if (load === undefined) return
    let hold = HOLDS.get(reached)
    if (hold === undefined || hold.load !== load) {
        // The first call to reach this load is the one that started it, where one started it at
        // all — a refresh starts a load no call handed a signal to, and `ending` is then inert.
        const fresh: Hold = {
            load,
            pinned: false,
            signals: new Set(),
            ending,
            release: () => {
                if (HOLDS.get(reached) !== fresh || loadOf(reached) !== load)
                    return
                if (fresh.pinned) return
                for (const each of fresh.signals) if (!each.aborted) return
                HOLDS.delete(reached)
                fresh.ending?.abort()
                abandonLoad(reached, aborted())
                ABANDONED.add(reached)
            },
        }
        hold = fresh
        HOLDS.set(reached, hold)
    }
    if (signal === undefined) {
        hold.pinned = true
        return
    }
    if (hold.signals.has(signal)) return
    const held = hold
    if (held.signals.size === 0)
        // A SIGNAL OUTLIVES THE LOADS HANDED IT — a page's own controller — so its listener goes
        // when the load settles, or it pins every value it was ever handed until it aborts.
        void Promise.resolve(reached).then(
            () => forget(held),
            () => forget(held),
        )
    held.signals.add(signal)
    if (signal.aborted) held.release()
    else signal.addEventListener('abort', held.release, { once: true })
}

function forget(hold: Hold): void {
    for (const signal of hold.signals)
        signal.removeEventListener('abort', hold.release)
}

// 16.13, 16.63, 16.64 — `timeout` ON EVERY CALL: a load that goes that long without progress — its
// answer, or a stream's next chunk — is ended where it stands, as 16.54 ends one, and refuses 504.
// ONE CLOCK PER LOAD: a call joining a load (1.8) is not a reason to give it longer, and the first
// clock would end the load at its own time whatever a second one did — so a join starts none.
const TIMED = new WeakMap<object, number>()

function timeLoad(reached: unknown, milliseconds: number | undefined): void {
    if (
        milliseconds === undefined ||
        !Number.isFinite(milliseconds) ||
        !isReactive(reached)
    )
        return
    const load = loadOf(reached)
    if (load === undefined || TIMED.get(reached) === load) return
    TIMED.set(reached, load)
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => {
            if (loadOf(reached) === load) abandonLoad(reached, refuse(504))
        }, milliseconds)
    }
    let settled = false
    let wake = (): void => {}
    const end = (): void => {
        settled = true
        clearTimeout(timer)
        wake()
    }
    arm()
    void Promise.resolve(reached).then(end, end)
    if (!isStreaming(reached)) return
    // A CHUNK IS PROGRESS. The live cursor wakes on each, and outlives the run — it waits on the next
    // one — so the run settling is a wake of its own, and is what lets the cursor go.
    const cursor = (reached as AsyncIterable<unknown>)[Symbol.asyncIterator]()
    void (async () => {
        try {
            while (!settled) {
                await new Promise<void>((resolve) => {
                    wake = resolve
                    cursor.next().then(
                        () => resolve(),
                        () => resolve(),
                    )
                })
                if (settled || loadOf(reached) !== load) return
                arm()
            }
        } finally {
            void cursor.return?.(undefined)
        }
    })()
}

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
