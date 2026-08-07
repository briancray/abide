// `rpc = memo + transport` and `socket = channel + transport`, the declaring half of both.
//
// The point of the two laws is that these functions return the SAME THING the local primitives do —
// a keyed memo, a channel — so a caller's whole vocabulary is already written and identical on both
// sides. The transport is not in here at all: it is in `registry.ts`, which serves what these
// declare, and in `$shared/transport.ts`, which is the same shape with a fetch for a body.
//
// A handler lives under `server/rpc/**` or `server/sockets/**` and the compiler elides the module in
// the browser lane, so nothing about this file — or anything it imports — reaches a browser.

import { type Channel, type ChannelOptions, channel, type RoomChannel } from '$shared/channel.ts'
import { isThenable } from '$shared/internal/probes.ts'
import { arm } from '$shared/internal/timers.ts'
import {
    chunkedBody,
    errorFrame,
    errorPayload,
    JSON_TYPE,
    NDJSON_TYPE,
    TTL_HEADER,
} from '$shared/internal/wire.ts'
import { type KeyedMemo, type MemoOptions, memo } from '$shared/memo.ts'
import { asRpc, type Method, type Rpc } from '$shared/transport.ts'
import { headersFor } from './responses.ts'

/** An env var, read where there may be no `process` at all — this entry point stays loadable in a browser. */
function ms(name: string, fallback: number): number {
    const held = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
        name
    ]
    if (held === undefined) return fallback
    const parsed = Number(held)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * The chain that authorizes and observes every call, INCLUDING an in-process one.
 *
 * `next()` takes no arguments, like every other onion in abide; the args are the second parameter,
 * because an authorization that cannot see what was asked for can only ever be per-endpoint. A
 * middleware that `await`s turns a handler's own return value into a promise, which is why a
 * streaming handler is recognised from the declaration rather than from what comes back.
 */
export type RpcMiddleware<Args, T> = (
    next: () => T | Promise<T> | AsyncIterable<T>,
    args: Args,
) => T | Promise<T> | AsyncIterable<T>

export interface RpcOptions<Args = unknown, T = unknown> {
    /** The human description carried onto every generated surface. */
    description?: string
    /** What the call retains, how long, and under which tags. */
    memo?: MemoOptions<Args>
    middleware?: RpcMiddleware<Args, T>[]
    /** ms the call may go without progress before it fails. Per chunk on a handler that yields. */
    timeout?: number
    /** Which other origins may call it, closed unless declared. `'*'` opens it to every origin. */
    crossOrigin?: string[]
    /** The largest request body this will accept, in bytes. */
    maxBodySize?: number
}

/** What `dispatch` needs to know about a declaration and a caller cannot ask it for. */
export interface RpcPolicy {
    /**
     * What a diagnostic calls it. The method until the module registers, because the address is a
     * fact about the FILE and a declaration does not know which file it is in.
     */
    address: string
    crossOrigin: string[] | null
    maxBodySize: number
    /** How long the client may serve what it loads, in ms. `Infinity` says nothing on the wire. */
    ttl: number
}

const RPC_POLICY = new WeakMap<object, RpcPolicy>()

export function policyOf(rpc: object): RpcPolicy | undefined {
    return RPC_POLICY.get(rpc)
}

/** What the registry calls once it knows where a declaration lives, so a failure names the endpoint. */
export function nameRpc(rpc: object, address: string): void {
    const policy = RPC_POLICY.get(rpc)
    if (policy !== undefined) policy.address = address
}

const NO_TIMEOUT = Infinity

function timeoutError(id: string, what: string, limit: number): Error {
    const failure = new Error(`abide: ${id} ${what} within ${limit}ms`)
    failure.name = 'AbideTimeoutError'
    return failure
}

function race<V>(promise: PromiseLike<V>, limit: number, failure: Error): Promise<V> {
    return new Promise<V>((resolve, reject) => {
        const timer = arm(() => reject(failure), limit)
        promise.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (error: unknown) => {
                clearTimeout(timer)
                reject(error as Error)
            },
        )
    })
}

/** Does this declaration yield? Read off the function itself, so no caller has to declare it twice. */
function isGenerator(body: unknown): boolean {
    const tag = Object.prototype.toString.call(body)
    return tag === '[object AsyncGeneratorFunction]' || tag === '[object GeneratorFunction]'
}

type Produced<T> = T | Promise<T> | AsyncIterable<T>

/**
 * The onion every chain in abide is, written once.
 *
 * `next()` takes no arguments; what the chain is ABOUT is the second parameter, so an authorization
 * that cannot see what was asked for is not the only kind anyone can write. Both callers below hand
 * it a different payload and a different innermost run, and nothing else about them differs.
 */
function through<Payload, R>(
    chain: ((next: () => R, payload: Payload) => R)[],
    payload: Payload,
    run: () => R,
): R {
    const step = (at: number): R => {
        if (at === chain.length) return run()
        return (chain[at] as (next: () => R, payload: Payload) => R)(() => step(at + 1), payload)
    }
    return step(0)
}

function chained<Args, T>(
    body: (args: Args) => Produced<T>,
    middleware: RpcMiddleware<Args, T>[] | undefined,
): (args: Args) => Produced<T> {
    if (middleware === undefined || middleware.length === 0) return body
    return (args: Args): Produced<T> => through(middleware, args, () => body(args))
}

function declare<Args, T>(
    method: Method,
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T>,
): Rpc<Args, T> {
    const streams = isGenerator(body)
    const limit = options.timeout ?? ms('ABIDE_RPC_TIMEOUT', 300_000)
    const run = chained(body, options.middleware)

    // A read retains what it loaded; a mutation retains nothing, which is `ttl: 0` — the slot still
    // coalesces the callers waiting on one in-flight call, and the next read runs the body again.
    const declared = options.memo
    const ttl = declared?.ttl ?? (method === 'GET' ? Infinity : 0)
    const policy: RpcPolicy = {
        address: method,
        crossOrigin: options.crossOrigin ?? null,
        maxBodySize: options.maxBodySize ?? ms('ABIDE_MAX_REQUEST_BODY_SIZE', Infinity),
        ttl,
    }

    // A stream is re-wrapped as a generator RETURNED SYNCHRONOUSLY, so a middleware that awaits
    // cannot turn the whole transcript into one value: the cell decides between a load and a stream
    // by what it is handed in the call, and a promise of a generator is a load.
    async function* streamed(args: Args): AsyncGenerator<T> {
        const produced = run(args)
        const source = (isThenable(produced) ? await produced : produced) as AsyncIterable<T>
        if (limit === NO_TIMEOUT) {
            yield* source
            return
        }
        const iterator = source[Symbol.asyncIterator]()
        // Built ONCE for the stream, not once per chunk: constructing an `Error` captures a stack,
        // and the timeout is the exception this arms for, never the value it hands back.
        const failure = timeoutError(policy.address, 'stopped producing', limit)
        try {
            for (;;) {
                const step = await race(iterator.next(), limit, failure)
                if (step.done === true) return
                yield step.value
            }
        } finally {
            await iterator.return?.()
        }
    }

    function load(args: Args): Produced<T> {
        if (streams) return streamed(args)
        const produced = run(args)
        // Guarded, never awaited: a synchronous handler must settle IN THE CALL, with no promise
        // wrap and no microtask before the first read sees it.
        if (limit === NO_TIMEOUT || !isThenable(produced)) return produced
        const failure = timeoutError(policy.address, 'did not settle', limit)
        return race(produced as PromiseLike<T>, limit, failure)
    }

    const cache: MemoOptions<Args> = { ...declared, ttl }
    const call = memo(load as (args: Args) => T, cache) as KeyedMemo<Args, T>

    const rpc: Rpc<Args, T> = asRpc(call, {
        method,
        description: options.description,
        raw: (args) => Promise.resolve(respond(rpc, args)),
    })
    RPC_POLICY.set(rpc, policy)
    return rpc
}

// --- the response ------------------------------------------------------------

function statusOf(error: unknown): number {
    if (error === null || typeof error !== 'object') return 500
    const held = (error as Record<string, unknown>).status
    return typeof held === 'number' && held >= 400 && held <= 599 ? held : 500
}

/** The rpc wire's headers: the shape's own, plus the one option that crosses as a header. */
function wireHeaders(ttl: number, type: string, extra: Record<string, string> | undefined): Headers {
    if (ttl === Infinity) return headersFor(extra, { 'content-type': type })
    return headersFor(extra, { 'content-type': type, [TTL_HEADER]: String(ttl) })
}

/**
 * A failure as a response, in the one shape a caller decodes.
 *
 * Takes the NAME and the message rather than an `Error`, because the gate in `registry.ts` refuses
 * with neither in hand — building one there only to read two fields back off it captures a stack per
 * 404, and `errorPayload` throws the rest away.
 */
export function failed(
    name: string,
    message: string,
    status: number,
    extra?: Record<string, string>,
): Response {
    return new Response(JSON.stringify(errorFrame(name, message)), {
        status,
        headers: wireHeaders(Infinity, JSON_TYPE, extra),
    })
}

/**
 * One call, as a response. What `dispatch` writes and what `fn.raw` hands back in-process, so the
 * two cannot disagree about what a failure or a stream looks like.
 */
export function respond<Args, T>(
    rpc: Rpc<Args, T>,
    args: Args,
    extra?: Record<string, string>,
): Response | Promise<Response> {
    const ttl = policyOf(rpc)?.ttl ?? Infinity
    const handle = rpc(args)
    try {
        // The read is what starts the work. A handler that yields hands the cell an async iterable
        // in this call, so `streaming` is already true by the time the next line asks.
        handle()
    } catch {
        // A retained failure. Asked about below, where it becomes a status rather than a throw.
    }
    if (handle.streaming() || handle.chunks().length > 0) {
        return new Response(chunkedBody(handle), { headers: wireHeaders(ttl, NDJSON_TYPE, extra) })
    }
    // Always through `then`, even for a handler that settled in the call above. Answering a settled
    // slot synchronously was tried and reverted: it removes two microtask ticks from the round trip,
    // and the client's `ttl: 0` expiry is an ARMED 0ms timer — a mutation answered that fast is
    // re-read from the client's own slot before that timer fires, so the second call never leaves.
    return handle.then(
        (settled) => value(settled, ttl, extra),
        (error: unknown) => {
            const carried = errorPayload(error).error
            return failed(carried.name, carried.message, statusOf(error), extra)
        },
    )
}

function value(held: unknown, ttl: number, extra: Record<string, string> | undefined): Response {
    return new Response(JSON.stringify(held ?? null), { headers: wireHeaders(ttl, JSON_TYPE, extra) })
}

// --- the five declarations ---------------------------------------------------
//
// One shape, five names. The name is the HTTP method the call travels as, so a network panel says
// what happened, and it is the one thing that decides whether the answer is retained: a read is
// worth keeping and a mutation is not.

export function GET<Args, T>(
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T> = {},
): Rpc<Args, T> {
    return declare('GET', body, options)
}

export function POST<Args, T>(
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T> = {},
): Rpc<Args, T> {
    return declare('POST', body, options)
}

export function PUT<Args, T>(
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T> = {},
): Rpc<Args, T> {
    return declare('PUT', body, options)
}

export function PATCH<Args, T>(
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T> = {},
): Rpc<Args, T> {
    return declare('PATCH', body, options)
}

export function DELETE<Args, T>(
    body: (args: Args) => Produced<T>,
    options: RpcOptions<Args, T> = {},
): Rpc<Args, T> {
    return declare('DELETE', body, options)
}

// --- socket ------------------------------------------------------------------

export interface SocketEvent<T, Args> {
    kind: 'subscribe' | 'publish'
    /** The room, or `undefined` for the stream a bare `sock()` reads. */
    room: Args | undefined
    /** What the client sent, on a publish. */
    message: T | undefined
    request: Request
}

/** The chain that authorizes each subscribe and each publish, per room. A throw refuses it. */
export type SocketMiddleware<T, Args> = (
    next: () => void | Promise<void>,
    event: SocketEvent<T, Args>,
) => void | Promise<void>

export interface SocketOptions<T = unknown, Args = unknown> {
    /** The underlying stream's own memory: how many messages it keeps and how long one stays current. */
    channel?: ChannelOptions
    /**
     * Whether clients may publish at all, and if so what happens to what they send. `false` — the
     * default — drops it: a socket is a broadcast until an app says otherwise, and a client that can
     * publish into a room is a client that can write to every subscriber of it.
     */
    clientPublish?: false | ((message: T, room: Args | undefined) => void | Promise<void>)
    middleware?: SocketMiddleware<T, Args>[]
    crossOrigin?: string[]
}

export interface SocketPolicy {
    clientPublish: false | ((message: unknown, room: unknown) => void | Promise<void>)
    middleware: SocketMiddleware<unknown, unknown>[]
    crossOrigin: string[] | null
}

const SOCKET_POLICY = new WeakMap<object, SocketPolicy>()

export function socketPolicyOf(stream: object): SocketPolicy | undefined {
    return SOCKET_POLICY.get(stream)
}

/**
 * The server half of a socket is `channel()` UNCHANGED.
 *
 * There is nothing to add, because the transport is not in the channel: an upgrade subscribes the
 * connection to the channel and a close unsubscribes it, which is the whole of it. What this adds is
 * the policy the wire needs and a local publisher does not.
 */
export function socket<T>(options?: SocketOptions<T, void>): Channel<T>
export function socket<T, Args>(options?: SocketOptions<T, Args>): RoomChannel<Args, T>
export function socket<T, Args>(options: SocketOptions<T, Args> = {}): Channel<T> & RoomChannel<Args, T> {
    const stream = channel<T, Args>(options.channel) as Channel<T> & RoomChannel<Args, T>
    SOCKET_POLICY.set(stream, {
        clientPublish: (options.clientPublish ?? false) as SocketPolicy['clientPublish'],
        middleware: (options.middleware ?? []) as SocketMiddleware<unknown, unknown>[],
        crossOrigin: options.crossOrigin ?? null,
    })
    return stream
}

/**
 * Run a socket's chain and let a refusal through as a throw.
 *
 * NOT `async`: the default socket has no middleware at all, and an unconditional promise wrap would
 * cost a microtask tick per subscribe and per inbound message for a chain with nothing in it.
 */
export function authorize<T, Args>(policy: SocketPolicy, event: SocketEvent<T, Args>): void | Promise<void> {
    const middleware = policy.middleware
    if (middleware.length === 0) return
    return through(middleware as SocketMiddleware<T, Args>[], event, () => undefined)
}
