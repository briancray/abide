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
import type { JsonSchema, Shapes } from '$shared/internal/shapes.ts'
import { arm } from '$shared/internal/timers.ts'
import {
    chunkedBody,
    errorFrame,
    errorPayload,
    JSON_TYPE,
    NDJSON_TYPE,
    TTL_HEADER,
} from '$shared/internal/wire.ts'
import { envNumber } from '$shared/log.ts'
import { type KeyedMemo, type MemoOptions, memo } from '$shared/memo.ts'
import { asRpc, type Method, type Rpc } from '$shared/transport.ts'
import { headersFor } from './responses.ts'
import { type Gate, gate, publishable, type Schema } from './schema.ts'

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

/**
 * The declared shape of a call, in each direction.
 *
 * Checked in the memo's BODY, which is the one place every door leads to: a wire call, an
 * in-process call and a handler another handler reaches all run it, so there is no door that could
 * be added later and forget to. A schema RETURNS what it accepts, so a normaliser is one too — the
 * handler is handed what the input schema produced, and a caller is answered what the output one
 * did.
 *
 * The slot is still keyed by what the CALLER asked with, not by what the schema made of it: the key
 * is the question, and two spellings of one question are two slots holding the same answer.
 */
export interface RpcSchemas<Args, T> {
    /** What a caller may send. A shape that does not match is the caller's fault, so it answers 422. */
    input?: Schema<Args>
    /** What the handler may answer with — per CHUNK on one that yields. This fault is ours: 500. */
    output?: Schema<T>
}

export interface RpcOptions<Args = unknown, T = unknown> {
    /** The human description carried onto every generated surface. */
    description?: string
    /** What the call retains, how long, and under which tags. */
    memo?: MemoOptions<Args>
    /** The declared shape of the input and the output, enforced at every door the call arrives through. */
    schemas?: RpcSchemas<Args, T>
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
    /** The handler yields, so the answer arrives as chunks. Published, because a caller plans for it. */
    streams: boolean
    /**
     * The PUBLISHED shape in each direction — what a tool definition or an OpenAPI document reads.
     *
     * A declared JSON Schema, or what the compiler derived from the type when the declaration was a
     * validator that can only answer "does this match". Both may be present at once, and they are
     * not the same question: one is checked, the other is published.
     */
    input: JsonSchema | null
    output: JsonSchema | null
    /**
     * The gates. Built at the declaration when a schema was declared, and when the module registers
     * otherwise — which is before anything can call, because the registration is appended to the
     * module that declares it. `null` on both means nothing to check and nothing to pay for it.
     */
    checkInput: Gate<unknown> | null
    checkOutput: Gate<unknown> | null
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

/**
 * The shapes the compiler derived from the declaration's TYPE, handed over when the module registers.
 *
 * They FILL IN rather than override: a declared schema is an author saying something the type does
 * not, so the derivation loses. What it still supplies in that case is the published shape, because
 * a validator and a library schema both answer "does this match" and neither answers "what is it".
 */
export function describeRpc(rpc: object, shapes: Shapes | undefined): void {
    const policy = RPC_POLICY.get(rpc)
    if (policy === undefined || shapes === undefined) return
    const input = shapes.input
    if (input !== undefined) {
        policy.input ??= input
        policy.checkInput ??= gate(input, 'input', 422, policy) as Gate<unknown>
    }
    const output = shapes.output
    if (output !== undefined) {
        policy.output ??= output
        policy.checkOutput ??= gate(output, 'output', 500, policy) as Gate<unknown>
    }
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
    const limit = options.timeout ?? envNumber('ABIDE_RPC_TIMEOUT', 300_000)
    const run = chained(body, options.middleware)

    // A read retains what it loaded; a mutation retains nothing, which is `ttl: 0` — the slot still
    // coalesces the callers waiting on one in-flight call, and the next read runs the body again.
    const retention = options.memo
    const ttl = retention?.ttl ?? (method === 'GET' ? Infinity : 0)
    const declared = options.schemas
    const policy: RpcPolicy = {
        address: method,
        crossOrigin: options.crossOrigin ?? null,
        maxBodySize: options.maxBodySize ?? envNumber('ABIDE_MAX_REQUEST_BODY_SIZE', Infinity),
        ttl,
        streams,
        input: publishable(declared?.input),
        output: publishable(declared?.output),
        checkInput: null,
        checkOutput: null,
    }
    // Built once, at the declaration, and `null` when no shape was declared — which is the whole
    // cost of a schema to an endpoint that has none. The gates take the policy rather than its
    // address, because the address is not known until the module registers, and they live ON it
    // because a shape the compiler derived arrives at that same moment.
    policy.checkInput = gate(declared?.input, 'input', 422, policy) as Gate<unknown> | null
    // A handler that answered the wrong shape is OUR fault, not the caller's, so it is not a 422.
    policy.checkOutput = gate(declared?.output, 'output', 500, policy) as Gate<unknown> | null

    // A stream is re-wrapped as a generator RETURNED SYNCHRONOUSLY, so a middleware that awaits
    // cannot turn the whole transcript into one value: the cell decides between a load and a stream
    // by what it is handed in the call, and a promise of a generator is a load. The input gate is
    // therefore INSIDE the generator rather than in `load` below, for the same reason.
    async function* streamed(args: Args): AsyncGenerator<T> {
        const input = policy.checkInput
        const output = policy.checkOutput
        let checked = args
        if (input !== null) {
            const gated = input(args)
            checked = (isThenable(gated) ? await gated : gated) as Args
        }
        const produced = run(checked)
        const source = (isThenable(produced) ? await produced : produced) as AsyncIterable<T>
        if (limit === NO_TIMEOUT && output === null) {
            yield* source
            return
        }
        const iterator = source[Symbol.asyncIterator]()
        // Built ONCE for the stream, not once per chunk: constructing an `Error` captures a stack,
        // and the timeout is the exception this arms for, never the value it hands back.
        const failure = limit === NO_TIMEOUT ? null : timeoutError(policy.address, 'stopped producing', limit)
        try {
            for (;;) {
                const stepping = iterator.next()
                const step = failure === null ? await stepping : await race(stepping, limit, failure)
                if (step.done === true) return
                if (output === null) {
                    yield step.value
                    continue
                }
                // Per CHUNK: a transcript is not one value, and a shape checked only at the end is a
                // shape nothing on the other side was reading by then.
                const gated = output(step.value)
                yield (isThenable(gated) ? await gated : gated) as T
            }
        } finally {
            await iterator.return?.()
        }
    }

    function load(args: Args): Produced<T> {
        if (streams) return streamed(args)
        const input = policy.checkInput
        if (input === null) return produce(args)
        // Guarded: a schema that settles in the call — every hand-written one, and every library one
        // over a plain object — must leave a synchronous handler settling in the call too.
        const gated = input(args)
        if (!isThenable(gated)) return produce(gated as Args)
        return (gated as Promise<Args>).then(produce) as Produced<T>
    }

    function produce(args: Args): Produced<T> {
        const produced = run(args)
        const output = policy.checkOutput
        // Guarded, never awaited: a synchronous handler must settle IN THE CALL, with no promise
        // wrap and no microtask before the first read sees it.
        if (!isThenable(produced)) return output === null ? produced : (output(produced) as Produced<T>)
        const settling: Promise<T> =
            limit === NO_TIMEOUT
                ? (produced as Promise<T>)
                : race(
                      produced as PromiseLike<T>,
                      limit,
                      timeoutError(policy.address, 'did not settle', limit),
                  )
        return output === null ? settling : (settling.then(output) as Promise<T>)
    }

    const cache: MemoOptions<Args> = { ...retention, ttl }
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
 * A refusal from the mount point itself, under the one name every `/__abide/**` lane refuses with.
 *
 * The message does NOT name abide: it is wrapped as `abide: <address> — <message>` when it reaches a
 * caller, and a reader of the raw body has the address in the URL bar already.
 */
export function refuse(message: string, status: number, headers?: Record<string, string>): Response {
    return failed('AbideTransportError', message, status, headers)
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
    /**
     * The declared shape of a message a CLIENT sends.
     *
     * The wire is the only door a message arrives through from outside the process, and it is the
     * only place this is checked: the server half of a socket is `channel()` unchanged, so an app
     * publishing into its own stream is publishing a value it already holds, not sending one.
     */
    schema?: Schema<T>
    middleware?: SocketMiddleware<T, Args>[]
    crossOrigin?: string[]
}

export interface SocketPolicy {
    /** What a diagnostic calls it. The kind until the module registers, like an rpc's. */
    address: string
    clientPublish: false | ((message: unknown, room: unknown) => void | Promise<void>)
    /** The PUBLISHED message shape — declared, or derived from the socket's first type argument. */
    message: JsonSchema | null
    /** The gate over an inbound one, or `null` when there is nothing to check. */
    checkMessage: Gate<unknown> | null
    middleware: SocketMiddleware<unknown, unknown>[]
    crossOrigin: string[] | null
}

const SOCKET_POLICY = new WeakMap<object, SocketPolicy>()

export function socketPolicyOf(stream: object): SocketPolicy | undefined {
    return SOCKET_POLICY.get(stream)
}

/** The socket half of `nameRpc`, called by the registry once it knows where the declaration lives. */
export function nameSocket(stream: object, address: string): void {
    const policy = SOCKET_POLICY.get(stream)
    if (policy !== undefined) policy.address = address
}

/** The socket half of `describeRpc`. A socket's `input` is its MESSAGE; it answers nothing. */
export function describeSocket(stream: object, shapes: Shapes | undefined): void {
    const policy = SOCKET_POLICY.get(stream)
    if (policy === undefined || shapes?.input === undefined) return
    policy.message ??= shapes.input
    policy.checkMessage ??= gate(shapes.input, 'message', 422, policy) as Gate<unknown>
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
    const policy: SocketPolicy = {
        address: 'socket',
        clientPublish: (options.clientPublish ?? false) as SocketPolicy['clientPublish'],
        message: publishable(options.schema as Schema<unknown> | undefined),
        checkMessage: null,
        middleware: (options.middleware ?? []) as SocketMiddleware<unknown, unknown>[],
        crossOrigin: options.crossOrigin ?? null,
    }
    // After the policy exists, because the gate reads the address off it at the throw — it is the
    // same object `nameSocket` writes to when the module registers.
    policy.checkMessage = gate(options.schema as Schema<unknown> | undefined, 'message', 422, policy)
    SOCKET_POLICY.set(stream, policy)
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
