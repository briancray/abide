// socket(...) — the named, typed, isomorphic pub/sub topic primitive (sockets.md S1-S2). A socket is
// an `AsyncIterable<T>`: subscribe by iterating (`for await (const m of sock)`), unsubscribe by
// breaking. `publish(msg)` is the server broadcast path. Client-mediated publishes go through the
// hub's `ingressPublish` (surfaced on `__socket` for the transport to call).
//
// The reactive PROBE surface (client-sockets.md CS1/CS4) — `peek`/`chunks`/`pending`/`refreshing`/
// `done`/`error` — is identical on both sides so the browser proxy (`ui/internal/socketProxy`) is the
// same `Socket<T>` type. On the server these are degenerate: the topic is in-proc, always "live", so
// the transport-lifecycle probes rest at their connected values; `peek`/`chunks` read the hub.
//
// One socket per file in `src/server/sockets/<name>.ts`; the name comes from the filename. This core
// is single-process (S3.3) — tail buffer + fanout live in one server process.

import { getContext } from '../shared/internal/context.ts'
import { type DROP, SocketHub } from './internal/socketHub.ts'

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
    crossOrigin?: unknown
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

// True while the current request is an SSR page render (set by `renderPage`). A socket iterated in a
// render must not open a live subscription — it would never close and would hang the flush; instead it
// yields the tail snapshot and completes (CS5). Outside a render (RPC handler, socket transport,
// background task) the iterator is the real live subscription.
function inRender(): boolean {
    return getContext().rendering === true
}

export function socket<T>(options?: SocketOptions<T>): Socket<T> {
    const hub = new SocketHub<T>(options ?? {})
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
        [Symbol.asyncIterator](): AsyncIterator<T> {
            return inRender() ? hub.snapshotIterator() : hub.subscribe()
        },
        __socket: {
            options: hub.options,
            ingressPublish: (message: T): Promise<void> => hub.ingressPublish(message),
            tailSnapshot: (): T[] => hub.tailSnapshot(),
            subscribe: (replay?: boolean): AsyncIterator<T> => hub.subscribe(replay),
        },
    }
}
