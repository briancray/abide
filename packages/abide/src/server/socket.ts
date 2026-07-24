// socket(...) — the named, typed, isomorphic pub/sub topic primitive (sockets.md S1-S2). A socket IS a
// `channel` + transport (ADR 0023): it builds on a single-topic `channel()` for the pub/sub core and
// adds the transport internals. Subscribe by iterating (`for await (const m of sock)`), unsubscribe by
// breaking. `publish(msg)` is the server broadcast path. Client-mediated publishes go through the
// socket-layer `ingressPublish` (runs the `handler`, then server-publishes — surfaced on `__socket` for
// the transport to call; the channel itself is pure pub/sub).
//
// The reactive PROBE surface (client-sockets.md CS1/CS4) — `peek`/`chunks`/`pending`/`refreshing`/
// `done`/`error` — is identical on both sides so the browser proxy (`ui/internal/socketProxy`) is the
// same `Socket<T>` type. On the server these are degenerate: the topic is in-proc, always "live", so
// the transport-lifecycle probes rest at their connected values; `peek`/`chunks` read the hub.
//
// One socket per file in `src/server/sockets/<name>.ts`; the name comes from the filename. This core
// is single-process (S3.3) — tail buffer + fanout live in one server process.

import { type ChannelOptions, channel } from './channel.ts'
import { DROP } from './internal/socketHub.ts'

// A mediating handler may return the transformed value to publish, or `void`/`DROP` to suppress the
// client publish. `DROP` is the explicit drop signal; a bare `void`/`undefined` return drops too.
export interface SocketOptions<T> {
    tail?: number
    ttl?: number
    clientPublish?: boolean
    schema?: unknown
    clients?: unknown
    // biome-ignore lint/suspicious/noConfusingVoidType: void lets a side-effect-only handler (returns nothing) be assignable; undefined would force an explicit return
    handler?: (message: T) => T | void | typeof DROP | Promise<T | void | typeof DROP>
}

// Internal handle carried on `__socket`: the resolved options, the transport ingress path, and the
// live subscribe used by the WS/HTTP transport (`replay: false` is the hydration join, CS5).
export interface SocketInternals<T> {
    options: SocketOptions<T>
    ingressPublish(message: T): Promise<void>
    tailSnapshot(): T[]
    subscribe(replay?: boolean): AsyncIterator<T>
}

export interface Socket<T> extends AsyncIterable<T> {
    publish(message: T): void
    // ACTIVE probes (client-sockets.md CS4.1) — reading these drives a subscription on the client.
    peek(): T | undefined
    chunks(): T[] | undefined
    // STATUS probes — observe the subscription lifecycle without driving it.
    pending(): boolean
    refreshing(): boolean
    done(): boolean
    error(): unknown | undefined
    readonly __socket: SocketInternals<T>
}

export function socket<T>(options: SocketOptions<T> = {}): Socket<T> {
    // A socket IS a channel + transport (ADR 0023). Build on a single-topic (void) channel for the
    // pub/sub core; the socket layer adds the transport internals + client-publish mediation. `ttl` is
    // the socket's name for the channel's per-message `maxAge`.
    const channelOptions: ChannelOptions = {}
    if (options.tail !== undefined) channelOptions.tail = options.tail
    if (options.ttl !== undefined) channelOptions.maxAge = options.ttl
    const ch = channel<T, void>(channelOptions)
    const hub = ch.__hub(undefined)
    return {
        publish(message: T): void {
            hub.publish(message)
        },
        peek: (): T | undefined => hub.peekLatest(),
        // Server chunks() = the in-window tail (what an SSR render paints / a fresh subscriber replays).
        chunks: (): T[] | undefined => hub.tailSnapshot(),
        // Degenerate on the server — an in-proc topic is immediately live, never reconnecting/errored,
        // and not torn down while the page is rendered (the client re-subscribes on hydrate).
        pending: (): boolean => false,
        refreshing: (): boolean => false,
        done: (): boolean => false,
        error: (): unknown | undefined => undefined,
        // Delegate to the channel, which yields the tail snapshot inside an SSR render (never hangs) and a
        // live subscription otherwise (CS5).
        [Symbol.asyncIterator](): AsyncIterator<T> {
            return ch[Symbol.asyncIterator]()
        },
        __socket: {
            options,
            // Client-publish mediation lives HERE now (the channel is pure pub/sub): run the handler,
            // then server-publish the transformed value. A `void`/`DROP` return suppresses.
            ingressPublish: async (message: T): Promise<void> => {
                const handler = options.handler
                if (handler === undefined) {
                    hub.publish(message)
                    return
                }
                const result = await handler(message)
                if (result === undefined || (result as unknown) === DROP) return
                hub.publish(result as T)
            },
            tailSnapshot: (): T[] => hub.tailSnapshot(),
            subscribe: (replay?: boolean): AsyncIterator<T> => hub.subscribe(replay),
        },
    }
}
