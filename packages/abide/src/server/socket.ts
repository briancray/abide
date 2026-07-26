// socket(...) — the named, typed, isomorphic pub/sub topic primitive (sockets.md S1-S2). A socket IS a
// `channel` + transport (ADR 0023): it builds on a single-topic `channel()` for the pub/sub core and
// adds the transport internals. Subscribe by iterating (`for await (const m of sock)`), unsubscribe by
// breaking. `publish(msg)` is the server broadcast path. Client-mediated publishes go through the
// socket-layer `ingressPublish` (runs the `clientPublish` mediator, then server-publishes — surfaced on
// `__socket` for the transport to call; the channel itself is pure pub/sub).
//
// The reactive PROBE surface (client-sockets.md CS1/CS4) — `peek`/`chunks`/`pending`/`refreshing`/
// `done`/`error` — is identical on both sides so the browser proxy (`ui/internal/socketProxy`) is the
// same `Socket<T>` type. On the server these are degenerate: the topic is in-proc, always "live", so
// the transport-lifecycle probes rest at their connected values; `peek`/`chunks` read the hub.
//
// One socket per file in `src/server/sockets/<name>.ts`; the name comes from the filename. This core
// is single-process (S3.3) — tail buffer + fanout live in one server process.

import { type ChannelOptions, channel } from '../shared/channel.ts'
import type { Room } from '../shared/internal/room.ts'
import { DROP } from './DROP.ts'
import type { Middleware } from './internal/middleware.ts'

// The client-publish policy (ADR 0023 §composition). `false`/omitted = clients may not publish; `true` =
// unmediated; a FUNCTION = mediated — it TRANSFORMS the untrusted message (or returns `DROP` to suppress),
// and its mere presence PERMITS the publish. Folding the mediator into the permission makes "a mediator on
// a closed publish path" unrepresentable, and matches the house `false | true | config` idiom.
// biome-ignore lint/suspicious/noConfusingVoidType: void lets a side-effect-only mediator (returns nothing → treated as DROP) be assignable.
export type ClientPublish<T> =
    | boolean
    | ((message: T) => T | void | typeof DROP | Promise<T | void | typeof DROP>)

export interface SocketOptions<T, Args = void> {
    tail?: number
    ttl?: number
    // `false`/omitted = no client publish · `true` = unmediated · fn = mediated (transform + DROP). The fn
    // form REPLACES the old `handler` — the mediator IS the permission.
    clientPublish?: ClientPublish<T>
    schema?: unknown
    clients?: unknown
    // Per-SUBSCRIBE (per-room) authorization — the socket analog of an rpc's `middleware`, run at each
    // room join with the connection's identity + the room args (a short-circuit denies). ABSENT ⇒ the
    // socket is connect-authed (any connected client may join any room), exactly like a middleware-less
    // rpc is public. This is the opt-in per-room security boundary (auth.md; ADR 0023 rooms).
    middleware?: Middleware[]
}

// Whether a client publish is PERMITTED at all — `true` (unmediated) or a mediator fn both admit it;
// `false`/omitted rejects. The single source of truth shared by the transport gate (router/mcp), the
// registry, and the client spec, so "is publish allowed" can never diverge from "is it mediated".
export function clientPublishAllowed(clientPublish: unknown): boolean {
    return clientPublish === true || typeof clientPublish === 'function'
}

// Internal handle carried on `__socket`: the resolved options + the per-room transport paths. Every path
// takes the room `args` (the void socket passes `undefined`). `replay: false` is the hydration join (CS5).
export interface SocketInternals<T, Args = void> {
    options: SocketOptions<T, Args>
    ingressPublish(args: Args, message: T): Promise<void>
    tailSnapshot(args: Args): T[]
    subscribe(args: Args, replay?: boolean): AsyncIterator<T>
}

export interface Socket<T, Args = void> extends AsyncIterable<T> {
    // Subscribe to a room — a fresh replay-then-live cursor. A void socket also iterates directly
    // (`for await m of socket`); a roomed socket picks a room (`socket({room})`).
    (...room: Room<Args>): AsyncIterable<T>
    // Server publish. Void: `publish(msg)`. Roomed: `publish({room}, msg)`.
    publish(...args: [...Room<Args>, message: T]): void
    // ACTIVE probes (client-sockets.md CS4.1) — reading these drives a subscription on the client.
    peek(...room: Room<Args>): T | undefined
    chunks(...room: Room<Args>): T[] | undefined
    // STATUS probes — observe the subscription lifecycle without driving it.
    pending(...room: Room<Args>): boolean
    refreshing(...room: Room<Args>): boolean
    done(...room: Room<Args>): boolean
    error(...room: Room<Args>): unknown | undefined
    readonly __socket: SocketInternals<T, Args>
}

// The transport-boundary view of a socket: the mux registry holds heterogeneous sockets, so BOTH the
// message type and the room args are erased. `any` (not `unknown`) is required — the contravariant
// `clientPublish` mediator param means a concrete `Socket<number, …>` is NOT assignable to
// `Socket<unknown, …>`; `any` is the only supertype every socket flows into. The transport touches only
// `__socket` (whose per-room paths take the room through) + the `AsyncIterable` face, never the surface.
// biome-ignore lint/suspicious/noExplicitAny: erased existential — see above; `unknown` breaks assignability through the contravariant clientPublish param.
export type ErasedSocket = Socket<any, any>

export function socket<T, Args = void>(options: SocketOptions<T, Args> = {}): Socket<T, Args> {
    // A socket IS a channel + transport (ADR 0023). Build on the `channel` primitive for the per-room
    // pub/sub core; the socket layer adds the transport internals + client-publish mediation. `ttl` is
    // the socket's name for the channel's per-message `maxAge`. `Args = void` → one hub under the void
    // key (today's single-topic socket); a non-void `Args` gives per-room hubs, created lazily.
    const channelOptions: ChannelOptions = {}
    if (options.tail !== undefined) channelOptions.tail = options.tail
    if (options.ttl !== undefined) channelOptions.maxAge = options.ttl
    const ch = channel<T, Args>(channelOptions)
    // The room key for a probe/publish call: void → `undefined` (0 room args), roomed → the sole room arg.
    const room = (args: unknown[]): Args =>
        args.length > 0 ? (args[0] as Args) : (undefined as Args)

    const sock = ((...room: Room<Args>): AsyncIterable<T> =>
        ch(room.length > 0 ? (room[0] as Args) : (undefined as Args))) as Socket<T, Args>

    // Direct iteration (`for await m of socket`) subscribes the DEFAULT (void) room.
    sock[Symbol.asyncIterator] = (): AsyncIterator<T> => ch[Symbol.asyncIterator]()
    // publish(...): void → `[message]`; roomed → `[room, message]`. The message is always last.
    sock.publish = (...args: [...Room<Args>, message: T]): void => {
        const message = args[args.length - 1] as T
        const roomArgs = args.length > 1 ? (args[0] as Args) : (undefined as Args)
        ch.__hub(roomArgs).publish(message)
    }
    sock.peek = (...r: Room<Args>): T | undefined => ch.__hub(room(r)).peekLatest()
    // Server chunks() = the in-window tail (what an SSR render paints / a fresh subscriber replays).
    sock.chunks = (...r: Room<Args>): T[] | undefined => ch.__hub(room(r)).tailSnapshot()
    // Degenerate on the server — an in-proc topic is immediately live, never reconnecting/errored, and not
    // torn down while the page is rendered (the client re-subscribes on hydrate).
    sock.pending = (): boolean => false
    sock.refreshing = (): boolean => false
    sock.done = (): boolean => false
    sock.error = (): unknown | undefined => undefined
    ;(sock as { __socket: SocketInternals<T, Args> }).__socket = {
        options,
        // Client-publish mediation lives HERE (the channel is pure pub/sub). `clientPublish === true` =
        // unmediated pass-through; a mediator fn TRANSFORMS the untrusted message and may `DROP`/void it;
        // `false`/omitted = not permitted → drop (defense in depth — the transport gate already rejects).
        ingressPublish: async (args: Args, message: T): Promise<void> => {
            const clientPublish = options.clientPublish
            if (clientPublish === true) {
                ch.__hub(args).publish(message)
                return
            }
            if (typeof clientPublish !== 'function') return
            const result = await clientPublish(message)
            if (result === undefined || (result as unknown) === DROP) return
            ch.__hub(args).publish(result as T)
        },
        tailSnapshot: (args: Args): T[] => ch.__hub(args).tailSnapshot(),
        subscribe: (args: Args, replay?: boolean): AsyncIterator<T> =>
            ch.__hub(args).subscribe(replay),
    }
    return sock
}
