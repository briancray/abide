// channel(...) — the args-keyed pub/sub PRIMITIVE (ADR 0023). A `channel` is the push/subscribe node of
// the concept tree: `publish(args, msg)` appends a message to the topic keyed by `args`, and iterating
// `channel(args)` subscribes to it. It implements the shared `ReactiveReadSurface` (peek/chunks/… over a
// room), so a caller programs to the same vocabulary a `memo` exposes.
//
// `Args` names the ROOM. `Args = void` is the single-topic default (today's socket — iterate the channel
// directly, `publish(msg)` with NO room placeholder); a non-void `Args` gives per-room topics
// (`channel({room})`, `publish({room}, msg)`), each a distinct hub created lazily. This mirrors exactly how a `memo` keeps per-args slots and
// how `rpc.publish({id}, v)` already broadcasts on the per-args `@rpc:` channel — one mechanism.
//
// This core is LOCAL (in-process): no transport, no auth. `socket = channel + transport + per-args auth`
// exposes it over the network (that's where authorization lives). The reactive probes are DEGENERATE here
// (read the hub directly); the client socket proxy is where they become reactive.
//
// `channel` is ISOMORPHIC — same import, same call, both sides — which is why it lives in `shared`
// alongside `state` and `memo`. Nothing it touches is server-only: the `ChannelHub` it runs on is pure
// in-memory pub/sub. A browser module can own a channel and fan messages out locally exactly as a server
// module can; `socket` is what puts one on the wire between them.

import { ChannelHub, type ChannelHubOptions } from './internal/channelHub.ts'
import { canonicalKey } from './internal/codec.ts'
import type { ReactiveReadSurface } from './internal/reactiveReadSurface.ts'
import { reactiveScope } from './internal/reactiveScope.ts'
import type { Room } from './internal/room.ts'

export interface ChannelOptions {
    // Replay depth for a late joiner (per room). Default 0.
    tail?: number
    // Per-MESSAGE freshness window (ms) for peek/replay. Default Infinity (sticky). NB: distinct from a
    // memo's slot `ttl` — this ages individual messages, it does not re-acquire.
    maxAge?: number
}

export interface Channel<T, Args = void> extends ReactiveReadSurface<Args, T>, AsyncIterable<T> {
    // Subscribe to the room `args` — a fresh replay-then-live cursor. `for await (const m of channel(args))`.
    (args: Args): AsyncIterable<T>
    // TRANSPORT hook (internal): the room's hub, for the server-form (`socket`) to wire replay-controlled
    // subscribe / tail snapshot / server publish onto the mux. Not part of the public pub/sub surface.
    __hub(args: Args): ChannelHub<T>
}

// True while an SSR page render is in flight — a live subscription would never close and would hang the
// render, so a channel iterated in a render yields the tail snapshot and completes (CS5).
function inRender(): boolean {
    return reactiveScope().rendering === true
}

export function channel<T, Args = void>(options: ChannelOptions = {}): Channel<T, Args> {
    // Built once (same for every room). Only set present keys — exactOptionalPropertyTypes rejects
    // `{ tail: undefined }` against `tail?: number`. `maxAge` is the channel's name for the hub's `ttl`.
    const hubOptions: ChannelHubOptions = {}
    if (options.tail !== undefined) hubOptions.tail = options.tail
    if (options.maxAge !== undefined) hubOptions.ttl = options.maxAge

    // One ChannelHub per room, keyed by canonicalKey(args). `Args = void` → a single hub under the void key.
    const hubs = new Map<string, ChannelHub<T>>()
    const hubFor = (args: Args): ChannelHub<T> => {
        const key = canonicalKey(args)
        let hub = hubs.get(key)
        if (hub === undefined) {
            hub = new ChannelHub<T>(hubOptions)
            hubs.set(key, hub)
        }
        return hub
    }
    const cursor = (args: Args): AsyncIterator<T> =>
        inRender() ? hubFor(args).snapshotIterator() : hubFor(args).subscribe()

    const ch = ((args: Args): AsyncIterable<T> => ({
        [Symbol.asyncIterator]: (): AsyncIterator<T> => cursor(args),
    })) as Channel<T, Args>

    // Direct iteration (`for await m of channel`) subscribes the DEFAULT (void) room.
    ch[Symbol.asyncIterator] = (): AsyncIterator<T> => cursor(undefined as Args)
    ch.__hub = (args: Args): ChannelHub<T> => hubFor(args)
    // The MESSAGE is always last; the room is what precedes it. Void → `[message]`, roomed →
    // `[room, message]` (an explicit `(undefined, message)` on a void channel unpacks identically).
    ch.publish = ((...args: [...Room<Args>, message: T]): void => {
        const message = args[args.length - 1] as T
        const roomArgs = args.length > 1 ? (args[0] as Args) : (undefined as Args)
        hubFor(roomArgs).publish(message)
    }) as Channel<T, Args>['publish']
    ch.peek = (args: Args): T | undefined => hubFor(args).peekLatest()
    ch.chunks = (args: Args): T[] | undefined => hubFor(args).tailSnapshot()
    // Degenerate on this in-process core: a local topic is immediately live, never reconnecting/errored,
    // and eternal.
    ch.pending = (): boolean => false
    ch.refreshing = (): boolean => false
    ch.error = (): unknown => undefined
    ch.done = (): boolean => false
    // A source-less local channel has nothing to re-acquire, so `refresh` is a no-op. `invalidate` clears
    // the retained tail (per room, or every room when no args) without detaching live subscribers.
    ch.refresh = (): void => {}
    ch.invalidate = (args?: Partial<Args> | Args): void => {
        if (args === undefined) {
            for (const hub of hubs.values()) hub.clearTail()
            return
        }
        hubs.get(canonicalKey(args))?.clearTail()
    }
    // The HANDLER is last, the room precedes it — same unpacking as `publish`.
    ch.watch = ((
        ...watched: [...Room<Args>, handler: (value: T | undefined) => void]
    ): (() => void) => {
        const handler = watched[watched.length - 1] as (value: T | undefined) => void
        const args = (watched.length > 1 ? watched[0] : undefined) as Args
        // Live-only (no replay): fire the handler per message on this room.
        const iterator = hubFor(args).subscribe(false)
        let disposed = false
        void (async () => {
            try {
                for (;;) {
                    const result = await iterator.next()
                    if (result.done === true || disposed) break
                    handler(result.value)
                }
            } catch {
                // Torn down.
            }
        })()
        return (): void => {
            disposed = true
            void iterator.return?.()
        }
    }) as Channel<T, Args>['watch']
    return ch
}
