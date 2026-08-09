// The client half of the two transport laws — `rpc = memo + transport` and `socket = channel +
// transport` — and the shapes both halves share.
//
// This is what a generated stub imports, and it is ordinary authoring vocabulary too: `remote(id)`
// by hand is exactly the file the compiler writes, which is what makes "the file you would have
// written" literally true rather than a figure of speech.
//
// The point of both laws is that the transport is the BODY and only the body. A `remote` is a keyed
// `memo` whose body happens to be a fetch, so the caller's whole vocabulary — `u({id})()`,
// `await u({id})`, `.peek()`, `.pending()`, `.invalidate()` — is already written and identical on
// both sides. Three concurrent readers of one key cost one request because the SLOT coalesces, not
// because anything here does.

import { type Channel, type ChannelOptions, channel, type KeyedChannel } from './channel.ts'
import { markSource } from './internal/BRANDS.ts'
import { keyOf, matcher } from './internal/keys.ts'
import { RPC_PREFIX, SOCKET_PREFIX } from './internal/PATHS.ts'
import { hasFile } from './internal/probes.ts'
import { arm } from './internal/timers.ts'
import { traceHeaders } from './internal/trace.ts'
import {
    argsQuery,
    chunksOf,
    encodeArgs,
    type Failed,
    isChunked,
    JSON_TYPE,
    MAX_GET_URL,
    multipartBody,
    payloadOf,
    TTL_HEADER,
    wireError,
} from './internal/wire.ts'
import { type KeyedMemo, type MemoHandle, memo } from './memo.ts'
import { untrack, watch } from './reactive.ts'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Which law a declaration is. The DIRECTORY it lives in is what says so. */
export type Kind = 'rpc' | 'socket'

export interface CallOptions {
    /**
     * Abandon THIS await when the signal aborts. Everyone else waiting on the same slot is
     * unaffected, because what is abandoned is the wait and not the load.
     */
    signal?: AbortSignal
}

/**
 * A slot's cell, plus the loop a handler that yields is consumed by — and the refusals it declared.
 *
 * `F` is what makes a caught failure more than a name. A handler that `return`s an `error.typed`
 * failure puts it in its own return type, `GET` splits that union into the value and the refusals,
 * and the first `isError` below reads the DATA back off the one whose name matched. It defaults to
 * `never`, which is a handler that declared none: the name overload is then the only one that
 * resolves, and asking is the boolean it always was.
 */
export interface RpcHandle<T, F extends Failed = never> extends MemoHandle<T>, AsyncIterable<T> {
    isError<Name extends F['name']>(failure: unknown, name: Name): failure is Extract<F, Failed<Name>>
    isError(failure: unknown, name: string): boolean
}

export interface Rpc<Args, T, F extends Failed = never> extends KeyedMemo<Args, T> {
    (args: Args, options?: CallOptions): RpcHandle<T, F>
    /** The same call, handed back as the raw response instead of a decoded value. */
    raw(args: Args, init?: RequestInit): Promise<Response>
    readonly method: Method
    readonly description: string | undefined
}

// --- the loop over a slot ----------------------------------------------------

/**
 * `for await (const chunk of fn(args))` — everything the slot has already produced, then everything
 * that comes next.
 *
 * The replay is what makes it a slot rather than a subscription: a second consumer of a stream that
 * has already run gets the whole of it, because the transcript is retained on the cell. A failure is
 * ASKED about rather than caught around the read, so the throw comes from the loop that is consuming
 * it and not from whichever reader happened to kick the load.
 */
async function* iterate<T>(handle: RpcHandle<T>): AsyncGenerator<T> {
    let wake: (() => void) | null = null
    // LEVEL-triggered, not edge-triggered. A generator spends most of its life suspended at a
    // `yield` waiting for its consumer, and every chunk that lands in that window would otherwise
    // wake nobody: the flag is what the loop checks before parking, so a producer faster than the
    // consumer cannot strand it. Over a real socket that is the common case, not the rare one.
    let moved = false
    const stop = watch(() => {
        handle.chunks()
        handle.streaming()
        handle.settled()
        handle.error()
        moved = true
        const resume = wake
        wake = null
        resume?.()
    })
    try {
        // The read is what starts the load. Untracked: this generator is not a reactive reader, and
        // it may well be running inside someone else's effect.
        untrack(() => {
            try {
                handle()
            } catch {
                // Asked about below, where the loop can throw it at its own consumer.
            }
        })
        let at = 0
        let finished = false
        let produced: T[] = []
        // Closures built ONCE for the whole loop rather than one per probe per turn: this runs per
        // chunk, and a producer faster than its consumer is the common case over a socket.
        const look = (): void => {
            // ASKED BEFORE the transcript is read, and that order is the whole of it: a stream that
            // ended between the two reads has already written its last chunk, so reading `chunks`
            // second cannot miss one. The other order drops the final chunk every time.
            finished = handle.settled() && !handle.streaming()
            produced = handle.chunks() as T[]
        }
        // Asked AFTER the transcript is handed over, so a failure that arrived while this was
        // suspended at a `yield` is thrown by the loop that was waiting on it.
        const asked = (): unknown => handle.error()
        for (;;) {
            moved = false
            untrack(look)
            while (at < produced.length) yield produced[at++] as T
            const failure = untrack(asked)
            if (failure !== undefined) throw failure
            if (finished) {
                // A handler that returned one value rather than yielding has no transcript, so the
                // loop hands over the value itself and ends. One shape reads both.
                if (at === 0) {
                    const value = untrack(() => handle.peek())
                    if (value !== undefined) yield value as T
                }
                return
            }
            if (moved) continue // something landed while this was suspended at a `yield`
            await new Promise<void>((resolve) => {
                wake = resolve
            })
        }
    } finally {
        stop()
    }
}

/**
 * The await, given up on when the signal is.
 *
 * The listener is REMOVED once the race is over, however it ended: `{ once: true }` only detaches on
 * an abort that fires, and a signal that outlives the call — one per page, one per component tree —
 * would otherwise collect a listener and a never-settled promise for every call made under it.
 */
function raceAbort<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason)
    let release: (() => void) | null = null
    const abandoned = new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => reject(signal.reason)
        signal.addEventListener('abort', onAbort)
        release = () => signal.removeEventListener('abort', onAbort)
    })
    return Promise.race([promise, abandoned]).finally(() => release?.())
}

/**
 * The slot, with an await that gives up when the signal does.
 *
 * A VIEW rather than a second slot: everything but `then` reaches the real handle through the
 * prototype, so `peek`, the probes and the verbs are the same cell's. Built only when a signal is
 * passed, which is why the prototype walk it costs is not on anyone's ordinary path.
 */
function abandonable<T>(handle: RpcHandle<T>, signal: AbortSignal): RpcHandle<T> {
    const view = (() => handle()) as RpcHandle<T>
    Object.setPrototypeOf(view, handle)
    view.then = ((onFulfilled: unknown, onRejected: unknown) =>
        raceAbort(handle as PromiseLike<T>, signal).then(
            onFulfilled as never,
            onRejected as never,
        )) as RpcHandle<T>['then']
    return view
}

interface RpcSpec<Args> {
    method: Method
    description: string | undefined
    raw(args: Args, init?: RequestInit): Promise<Response>
}

/**
 * A keyed memo, wearing the rpc surface. Both lanes end here, which is the law made structural: the
 * server's `GET` and the browser's `remote` differ in the body they were handed and in nothing else.
 */
export function asRpc<Args, T>(call: KeyedMemo<Args, T>, spec: RpcSpec<Args>): Rpc<Args, T> {
    const rpc = ((args: Args, options?: CallOptions): RpcHandle<T> => {
        const handle = call(args) as RpcHandle<T>
        // Attached to the SLOT and once per slot: the handle is the same object every time the key
        // is selected, so this is a lookup on every call but the first.
        const attach = handle as unknown as { [Symbol.asyncIterator]?: () => AsyncIterator<T> }
        if (attach[Symbol.asyncIterator] === undefined) attach[Symbol.asyncIterator] = () => iterate(handle)
        if (options === undefined || options.signal === undefined) return handle
        return abandonable(handle, options.signal)
    }) as Rpc<Args, T>
    rpc.invalidate = call.invalidate
    rpc.refresh = call.refresh
    rpc.raw = spec.raw
    Object.defineProperty(rpc, 'method', { value: spec.method, enumerable: true })
    Object.defineProperty(rpc, 'description', { value: spec.description, enumerable: true })
    return rpc
}

// --- rpc, the browser lane ---------------------------------------------------

/**
 * Which app a call is addressed to.
 *
 * One declaration rather than one per caller — `remote` and `health` mean the same thing by these two
 * words, and two bags with the same fields drift without the checker ever noticing.
 */
export interface WireOptions {
    /**
     * Where the app is. Omitted in a browser, where the path is relative and there is nothing to
     * sniff: a stub is only ever LOADED in the browser lane, and a caller anywhere else has to say
     * where the server is rather than have a DOM emulator's `location` guessed on its behalf.
     */
    base?: string
    /**
     * The transport. Anything `fetch`-shaped — a proxy, a client that carries a header, or a
     * `dispatch` called in-process, which is what lets a demo make the same claims with no wire.
     */
    fetch?: (input: string, init: RequestInit) => Promise<Response>
}

export interface RemoteOptions extends WireOptions {
    method?: Method
    /** The handler YIELDS, so the response is a stream of chunks. Emitted by the compiler. */
    stream?: boolean
}

/**
 * The caller's headers plus the trace, so the next hop CONTINUES this operation rather than
 * starting one. Without this a trace stopped at the first outbound call, which is the one place
 * it was worth anything.
 *
 * The caller's own win: an explicit `traceparent` on `fn.raw(args, init)` is somebody saying
 * where this call belongs, and a framework default has no business overruling it.
 *
 * On a CLIENT there is never a source installed, so this is one null compare and the caller's
 * headers come back untouched and unallocated — a browser has no request to belong to, and one
 * inventing a trace id would be asserting a relationship to work it cannot see.
 *
 * Module scope because it captures nothing from a declaration: one function for the process rather
 * than a closure per declared endpoint.
 */
// Two signatures because the two call sites genuinely differ: a mutation always has a
// `content-type` to merge into, so its result is never absent, and only a bare read's can be.
function continued(carried: Record<string, string>): Record<string, string>
function continued(carried: Record<string, string> | undefined): Record<string, string> | undefined
function continued(carried: Record<string, string> | undefined): Record<string, string> | undefined {
    const traced = traceHeaders()
    if (traced === null) return carried
    if (carried === undefined) return traced
    return { ...traced, ...carried }
}

export function remote<Args, T, F extends Failed = never>(
    id: string,
    options: RemoteOptions = {},
): Rpc<Args, T, F> {
    const method = options.method ?? 'GET'
    const streams = options.stream === true
    const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init))
    const path = RPC_PREFIX + id
    const address = options.base === undefined ? path : new URL(path, options.base).href

    // A read is an HTTP GET with one query parameter per argument, so the address says what was
    // asked and an intermediary may cache it; a mutation is its own method with a JSON body. Two
    // things send a read to a body instead, and they are the same thing twice: the args do not fit
    // in a URL. One is the ceiling every proxy puts on length; the other is a FILE, which has no text
    // form at all. The server accepts a body for a read for exactly this reason, so neither is a
    // second endpoint.
    function ask(args: Args, init?: RequestInit): Promise<Response> {
        // Asked before anything is built rather than read off an encoding: a read that fits in a URL
        // is the whole of the client's ordinary path, and it should not pay a `JSON.stringify` of
        // the args to find out that it is one.
        if (method === 'GET' && !hasFile(args)) {
            const url = address + argsQuery(args)
            if (url.length <= MAX_GET_URL) {
                const headers = continued(init?.headers as Record<string, string> | undefined)
                // The key is omitted rather than set to `undefined`: a read with no headers at all is
                // the client's whole path, and it should allocate nothing to stay that way.
                return headers === undefined
                    ? send(url, { method: 'GET', ...init })
                    : send(url, { method: 'GET', ...init, headers })
            }
        }
        const encoded = encodeArgs(args)
        const sending = method === 'GET' ? 'POST' : method
        if (encoded.files !== null) {
            // No `content-type` of our own: `fetch` writes one naming the boundary it chose, and a
            // header saying otherwise is a body nothing on the other side can parse.
            const headers = continued(init?.headers as Record<string, string> | undefined)
            const body = multipartBody(encoded)
            return headers === undefined
                ? send(address, { ...init, method: sending, body })
                : send(address, { ...init, method: sending, headers, body })
        }
        return send(address, {
            ...init,
            method: sending,
            headers: continued({ 'content-type': JSON_TYPE, ...(init?.headers as Record<string, string>) }),
            body: encoded.text,
        })
    }

    // One armed timer PER SLOT, not per response: a slot that reloads before its ttl is up replaces
    // its own expiry rather than stacking a second one that fires a redundant invalidate later.
    const expiries = new Map<string, ReturnType<typeof setTimeout>>()

    // The one option that crosses the wire, and it arrives as a header rather than as source the
    // stub copied: `opts.memo` is server-side text, and an option may reference a server-only
    // import. What crosses is the CONSEQUENCE — how long this answer may be served.
    function expire(args: Args, response: Response): void {
        const header = response.headers.get(TTL_HEADER)
        if (header === null) return
        const ms = Number(header)
        if (!Number.isFinite(ms) || ms < 0) return
        const key = keyOf(args)
        const held = expiries.get(key)
        if (held !== undefined) clearTimeout(held)
        expiries.set(
            key,
            arm(() => {
                expiries.delete(key)
                call(args).invalidate()
            }, ms),
        )
    }

    async function value(args: Args): Promise<T> {
        const response = await ask(args)
        const payload = await payloadOf(response)
        if (!response.ok) throw wireError(id, response.status, payload)
        expire(args, response)
        return payload as T
    }

    // Returned SYNCHRONOUSLY, so the cell sees an async iterable and consumes it as a stream. An
    // `async` function here would hand it a promise OF a generator, and the whole transcript would
    // land as one value.
    async function* chunks(args: Args): AsyncGenerator<T> {
        const response = await ask(args)
        if (!response.ok) throw wireError(id, response.status, await payloadOf(response))
        expire(args, response)
        if (!isChunked(response)) {
            yield (await payloadOf(response)) as T
            return
        }
        for await (const chunk of chunksOf(id, response)) yield chunk as T
    }

    const load = streams
        ? (args: Args): AsyncIterable<T> => chunks(args)
        : (args: Args): Promise<T> => value(args)
    const call = memo(load) as unknown as KeyedMemo<Args, T>

    // The refusals are a claim about the TYPE and nothing else — a stub written by hand says what
    // the endpoint it addresses refuses with, the same way it says what it answers with. A stub the
    // compiler writes says neither: the caller's checker reads the handler's own declaration.
    return asRpc(call, {
        method,
        description: undefined,
        raw: (args, init) => ask(args, init),
    }) as Rpc<Args, T, F>
}

// --- socket, the browser lane ------------------------------------------------

/**
 * What a connection has to answer. A `WebSocket` satisfies it; so does anything a test or a proxy
 * wants to put in its place, which is the seam a demo drives the whole law through without a wire.
 */
export interface Wire {
    send(data: string): void
    close(): void
    onmessage: ((event: { data: unknown }) => void) | null
    onopen: (() => void) | null
    onclose: (() => void) | null
}

export interface RemoteSocketOptions {
    base?: string
    /** The underlying stream's own memory — how many messages it keeps, and how long one is current. */
    channel?: ChannelOptions
    /** How the connection is made. Defaults to a real `WebSocket`. */
    open?: (url: string) => Wire
}

/**
 * A client socket: an ordinary `Channel`, plus the wire's own verb.
 *
 * `close` is not on the server's half and does not need to be — a component never calls it, and the
 * type a component is checked against is the server module's, because the stub only exists at build
 * time. It is here for the caller that owns the connection: a test, a script, a page tearing down.
 */
export type RemoteSocket<T, Args = void> = Channel<T> & KeyedChannel<Args, T> & { close(): void }

/** One room's connection: an ordinary channel with the wire's verb on it. */
type Connection<T> = Channel<T> & { close(): void }

/** Reconnect backoff: doubling from here, capped, so a server restart is caught quickly and a dead one is not hammered. */
const RECONNECT_FROM = 250
const RECONNECT_CAP = 5_000

export function remoteSocket<T, Args = void>(
    id: string,
    options: RemoteSocketOptions = {},
): RemoteSocket<T, Args> {
    const rooms = new Map<string, { args: Args; room: Connection<T> }>()
    let bare: Connection<T> | null = null
    const held = (): Connection<T> => (bare ??= connect<T>(id, undefined, options))

    const self = markSource(((args?: Args) => {
        if (args === undefined) return held()()
        const key = keyOf(args)
        const entry = rooms.get(key)
        if (entry !== undefined) return entry.room
        const room = connect<T>(id, args, options)
        rooms.set(key, { args, room })
        return room
    }) as RemoteSocket<T, Args>)

    // Forwarded rather than inherited, because `bare` does not exist until something asks: a socket
    // an app imported and never read must not open a connection. A READ builds it; a probe answers
    // the channel's own cold value instead, which is what keeps probes questions rather than causes.
    //
    // A TABLE typed by `keyof Channel`, not thirteen assignments — the same reason `memo.ts` builds
    // its facade this way: a member added to the channel surface is a type error HERE, rather than a
    // member left silently `undefined` on every remote socket, in the one lane with a wire in it.
    // `invalidate` is out of it because a room pattern is the one thing this shape means differently.
    const forward: { [K in keyof Omit<Channel<T>, 'invalidate'>]: Channel<T>[K] } = {
        publish: (message) => held().publish(message),
        peek: () => bare?.peek(),
        chunks: () => held().chunks(),
        settled: () => bare?.settled() ?? false,
        pending: () => bare?.pending() ?? false,
        refreshing: () => bare?.refreshing() ?? false,
        error: () => bare?.error(),
        streaming: () => bare?.streaming() ?? true,
        done: () => bare?.done() ?? false,
        isError: (error, name) => held().isError(error, name),
        watch: (handler) => held().watch(handler),
        subscribe: (listener) => held().subscribe(listener),
        tail: () => held().tail(),
        [Symbol.asyncIterator]: () => held()[Symbol.asyncIterator](),
    }
    Object.assign(self, forward)

    self.invalidate = (pattern?: Partial<Args>): void => {
        const wanted = matcher(pattern)
        for (const entry of rooms.values()) if (wanted(entry.args)) entry.room.invalidate()
        // A pattern names ROOMS, so it stops there; a bare `invalidate()` means everything, and the
        // stream the bare `ch()` reads is part of everything.
        if (pattern === undefined) bare?.invalidate()
    }
    self.close = (): void => {
        for (const entry of rooms.values()) entry.room.close()
        rooms.clear()
        bare?.close()
        bare = null
    }
    return self
}

/** One room, one connection. Opened by the first READ, never by construction. */
function connect<T>(id: string, args: unknown, options: RemoteSocketOptions): Connection<T> {
    const received = channel<T>(options.channel)
    const path = SOCKET_PREFIX + id
    const relative = args === undefined ? path : path + argsQuery(args)
    const base = options.base ?? (globalThis as { location?: { href: string } }).location?.href
    const address = base === undefined ? relative : new URL(relative, base).href
    const url = address.replace(/^http/, 'ws')
    const open = options.open ?? ((at: string) => new WebSocket(at) as unknown as Wire)

    let wire: Wire | null = null
    let closed = false
    let backoff = RECONNECT_FROM
    /** Published before the connection was up. A publish is fire-and-forget, not fire-and-lose. */
    const queued: string[] = []

    function start(): void {
        if (wire !== null || closed) return
        const connection = open(url)
        wire = connection
        connection.onopen = () => {
            backoff = RECONNECT_FROM
            while (queued.length > 0) connection.send(queued.shift() as string)
        }
        connection.onmessage = (event) => received.publish(JSON.parse(String(event.data)) as T)
        connection.onclose = () => {
            if (closed || wire !== connection) return
            wire = null
            // Reconnecting is the whole difference between a socket and a websocket: a subscriber
            // asked for the stream, not for one TCP connection's worth of it.
            arm(start, backoff)
            backoff = Math.min(backoff * 2, RECONNECT_CAP)
        }
    }

    const read = received as unknown as () => T | undefined
    const chunks = received.chunks
    const subscribe = received.subscribe
    const iterator = received[Symbol.asyncIterator].bind(received)
    const tail = received.tail.bind(received)

    // Reads may start work; probes may not. `peek` and the probes therefore never open a connection,
    // which is what keeps them questions rather than causes.
    const self = markSource((() => {
        start()
        return read()
    }) as Connection<T>)
    Object.setPrototypeOf(self, received)
    self.chunks = () => {
        start()
        return chunks()
    }
    self.subscribe = (listener) => {
        start()
        return subscribe(listener)
    }
    self[Symbol.asyncIterator] = () => {
        start()
        return iterator()
    }
    self.tail = () => {
        start()
        return tail()
    }
    // A client publish goes to the SERVER, which decides what happens to it — `clientPublish` is a
    // policy, and the policy is not here. Nothing is published locally: the echo, if the server
    // allows one, arrives the way every other message does.
    self.publish = (message) => {
        start()
        const frame = JSON.stringify(message)
        if (wire === null) queued.push(frame)
        else wire.send(frame)
    }
    self.close = () => {
        closed = true
        wire?.close()
        wire = null
    }
    return self
}
