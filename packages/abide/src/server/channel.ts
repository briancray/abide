// channel(...) — the args-keyed pub/sub PRIMITIVE (ADR 0023). A `channel` is the push/subscribe node of
// the concept tree: `publish(args, msg)` appends a message to the topic keyed by `args`, and iterating
// `channel(args)` subscribes to it. It implements the shared `ReactiveReadSurface` (peek/chunks/… over a
// room), so a caller programs to the same vocabulary a `memo` exposes.
//
// `Args` names the ROOM. `Args = void` is the single-topic default (today's socket — iterate the channel
// directly, `publish(msg)`); a non-void `Args` gives per-room topics (`channel({room})`, `publish({room},
// msg)`), each a distinct hub created lazily. This mirrors exactly how a `memo` keeps per-args slots and
// how `rpc.publish({id}, v)` already broadcasts on the per-args `@rpc:` channel — one mechanism.
//
// This core is LOCAL (in-process): no transport, no auth. `socket = channel + transport + per-args auth`
// exposes it over the network (that's where authorization lives). The reactive probes are DEGENERATE here
// (read the hub directly), as on today's server socket; the client proxy is where they become reactive.

import { canonicalKey } from '../shared/internal/codec.ts'
import { getContext } from '../shared/internal/context.ts'
import type { ReactiveReadSurface } from '../shared/internal/reactiveReadSurface.ts'
import { SocketHub } from './internal/socketHub.ts'
import type { SocketOptions } from './socket.ts'

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
    __hub(args: Args): SocketHub<T>
}

// True while an SSR page render is in flight — a live subscription would never close and would hang the
// render, so a channel iterated in a render yields the tail snapshot and completes (CS5).
function inRender(): boolean {
    return getContext().rendering === true
}

export function channel<T, Args = void>(options: ChannelOptions = {}): Channel<T, Args> {
    // Built once (same for every room). Only set present keys — exactOptionalPropertyTypes rejects
    // `{ tail: undefined }` against `tail?: number`. `maxAge` is the channel's name for the hub's `ttl`.
    const hubOptions: SocketOptions<T> = {}
    if (options.tail !== undefined) hubOptions.tail = options.tail
    if (options.maxAge !== undefined) hubOptions.ttl = options.maxAge

    // One SocketHub per room, keyed by canonicalKey(args). `Args = void` → a single hub under the void key.
    const hubs = new Map<string, SocketHub<T>>()
    const hubFor = (args: Args): SocketHub<T> => {
        const key = canonicalKey(args)
        let hub = hubs.get(key)
        if (hub === undefined) {
            hub = new SocketHub<T>(hubOptions)
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
    ch.__hub = (args: Args): SocketHub<T> => hubFor(args)
    ch.publish = (args: Args, message: T): void => {
        hubFor(args).publish(message)
    }
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
    ch.watch = (args: Args, handler: (value: T | undefined) => void): (() => void) => {
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
    }
    return ch
}
