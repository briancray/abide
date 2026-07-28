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
import type { SocketSurface } from '../shared/internal/socketSurface.ts'
import { DROP } from './DROP.ts'
import type { Middleware } from './internal/middleware.ts'
import type { ClientsOption } from './internal/registry.ts'

// The client-publish policy (ADR 0023 §composition). `false`/omitted = clients may not publish; `true` =
// unmediated; a FUNCTION = mediated — it TRANSFORMS the untrusted message (or returns `DROP` to suppress),
// and its mere presence PERMITS the publish. Folding the mediator into the permission makes "a mediator on
// a closed publish path" unrepresentable, and matches the house `false | true | config` idiom.
// biome-ignore lint/suspicious/noConfusingVoidType: void lets a side-effect-only mediator (returns nothing → treated as DROP) be assignable.
export type ClientPublish<T> =
    | boolean
    | ((message: T) => T | void | typeof DROP | Promise<T | void | typeof DROP>)

export interface SocketOptions<T> {
    // The pub/sub core's OWN options, passed through verbatim (ADR 0027 D1: a transported form NESTS its
    // primitive's options rather than flattening them). Nesting is what keeps the vocabulary honest — a
    // socket adds transport and authorization, not names. Flattening these cost the namespace, which is
    // how `socket({ ttl })` (per-MESSAGE age window) came to collide with `memo({ ttl })` (per-SLOT
    // retention); the channel's own word is `maxAge`, and now it arrives by construction with nothing to
    // translate.
    channel?: ChannelOptions
    // `false`/omitted = no client publish · `true` = unmediated · fn = mediated (transform + DROP). The fn
    // form REPLACES the old `handler` — the mediator IS the permission.
    clientPublish?: ClientPublish<T>
    schema?: unknown
    // REACHABILITY only — which surfaces reach this socket. NOT authorization (that is `middleware`,
    // which authorizes each room join). Typed as of ADR 0027 D9.
    clients?: ClientsOption
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
    options: SocketOptions<T>
    ingressPublish(args: Args, message: T): Promise<void>
    tailSnapshot(args: Args): T[]
    subscribe(args: Args, replay?: boolean): AsyncIterator<T>
}

// A socket is its ISOMORPHIC surface plus the server-only transport handle. The surface itself lives in
// `shared/internal/socketSurface.ts` so the browser proxy can be type-checked against it — `__socket` is
// precisely the part the proxy must not implement, so the split falls there.
export interface Socket<T, Args = void> extends SocketSurface<T, Args> {
    readonly __socket: SocketInternals<T, Args>
}

// The transport-boundary view of a socket: the mux registry holds heterogeneous sockets, so BOTH the
// message type and the room args are erased. `any` (not `unknown`) is required — the contravariant
// `clientPublish` mediator param means a concrete `Socket<number, …>` is NOT assignable to
// `Socket<unknown, …>`; `any` is the only supertype every socket flows into. The transport touches only
// `__socket` (whose per-room paths take the room through) + the `AsyncIterable` face, never the surface.
// biome-ignore lint/suspicious/noExplicitAny: erased existential — see above; `unknown` breaks assignability through the contravariant clientPublish param.
export type ErasedSocket = Socket<any, any>

export function socket<T, Args = void>(options: SocketOptions<T> = {}): Socket<T, Args> {
    // A socket IS a channel + transport (ADR 0023). Build on the `channel` primitive for the per-room
    // pub/sub core; the socket layer adds the transport internals + client-publish mediation. The
    // channel's options pass straight through (ADR 0027 D1) — there is no translation step, because a
    // socket has no option vocabulary of its own. `Args = void` → one hub under the void key (today's
    // single-topic socket); a non-void `Args` gives per-room hubs, created lazily.
    const ch = channel<T, Args>(options.channel ?? {})
    // The room key for a probe/publish call: void → `undefined` (0 room args), roomed → the sole room arg.
    const room = (args: unknown[]): Args =>
        args.length > 0 ? (args[0] as Args) : (undefined as Args)

    const sock = ((...room: Room<Args>): AsyncIterable<T> =>
        ch(room.length > 0 ? (room[0] as Args) : (undefined as Args))) as Socket<T, Args>

    // Direct iteration (`for await m of socket`) subscribes the DEFAULT (void) room.
    sock[Symbol.asyncIterator] = (): AsyncIterator<T> => ch[Symbol.asyncIterator]()
    // THE SURFACE IS THE CHANNEL'S (ADR 0027 D4). Every probe/verb below DELEGATES — it does not
    // re-derive. `socket = channel + transport` is only a law if the socket adds transport and nothing
    // else; when this block hand-rolled `peek`/`chunks` off `ch.__hub(...)` and re-declared the four
    // degenerate probes that `shared/channel.ts` already declares, the law was decorative and the two
    // copies were free to drift. The remaining `__hub` reaches are in `__socket` below, where they are
    // the genuine transport hook (replay-controlled subscribe / tail snapshot for the mux).
    //
    // On the server these rest at their connected values because an in-proc topic has no transport to be
    // pending on — probe liveness follows the TRANSPORT, which is why the browser proxy's versions are
    // reactive and these are not. Same surface, honest per side.
    sock.publish = (...args: [...Room<Args>, message: T]): void => {
        const message = args[args.length - 1] as T
        const roomArgs = args.length > 1 ? (args[0] as Args) : (undefined as Args)
        ch.publish(roomArgs, message)
    }
    sock.peek = (...r: Room<Args>): T | undefined => ch.peek(room(r))
    // Server chunks() = the in-window tail (what an SSR render paints / a fresh subscriber replays).
    sock.chunks = (...r: Room<Args>): T[] | undefined => ch.chunks(room(r))
    sock.pending = (...r: Room<Args>): boolean => ch.pending(room(r))
    sock.refreshing = (...r: Room<Args>): boolean => ch.refreshing(room(r))
    sock.done = (...r: Room<Args>): boolean => ch.done(room(r))
    sock.error = (...r: Room<Args>): unknown | undefined => ch.error(room(r))
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
