import type { CacheOnContext } from './CacheOnContext.ts'
import type { ClientFlags } from './ClientFlags.ts'
import type { TailHooks } from './TailHooks.ts'

/*
Bidirectional named broadcast primitive. Declared once with `socket<T>()`
inside a file under `src/server/sockets/`; the same import resolves to a server-side
fan-out and a client-side ws proxy by build target. Iterating the socket
is the live stream — no replay. `.tail(count)` opens a subscription seeded
with the last `count` frames of the retained tail (declared via
`{ tail: n }`; no-arg = the whole retained tail) before going live — the
optional Subscribable retention capability a reactive `watch(socket, …)`
seeds from. `broadcast` is isomorphic: server code broadcasts in-process
and fans out to remote subscribers; client code sends a `pub` frame the
dispatcher validates against the topic's `clientPublish` flag. `clients`
exposes which adapter surfaces (browser / mcp / cli) advertise this
socket.
*/
export interface Socket<T> extends AsyncIterable<T> {
    readonly name: string
    readonly clients: ClientFlags
    /* Send a frame to every subscriber (server always; client only when `clientPublish` is
       set). Isomorphic: server code fans out in-process + to remote subscribers; client code
       sends a validated `pub` frame. */
    broadcast(message: T): void
    tail(count?: number, hooks?: TailHooks): AsyncIterable<T>
    /* The latest retained frame, synchronously — `T | undefined` when none. The value
       member of the probe family for a stream; `peek(socket)` routes here. */
    peek(): T | undefined
    /* Reactive probe sugar mirroring the rpc instance — the socket is the pre-bound stream
       selector: `socket.pending()` ≡ `pending(socket)` (no frame yet), `socket.refreshing()` ≡
       `refreshing(socket)` (a held frame revalidating, e.g. across a reconnect gap),
       `socket.done()` ≡ `done(socket)` (the stream closed). Client-reactive; on the server (and
       the raw test builder) they read the same fallbacks the globals give with no tail prober
       registered (pending true until a frame, refreshing/done false). */
    pending(): boolean
    refreshing(): boolean
    done(): boolean
    /* The stream's terminal error, or undefined. Instance-only — like the rpc's `.error`, since a
       bare `error` global would shadow the server `error()` thrower. Reactive off the tail prober's
       error field; undefined on the server. */
    error(): Error | undefined
    /* Drop local frames and re-pull the server's retained tail — the socket analog of
       getFoo.refresh(), for a ttl-expired frame or a reconnect resync. Server-side it is a
       no-op (the server IS the source). */
    refresh(): void
    /* Client-only reaction sugar: `socket.watch(handler)` ≡ `watch(socket, handler)` — the
       handler runs per delivered frame with reconnect-replay and returns a scope-tied disposer.
       Reaction is a client concern (`watch` is a ui primitive that never rides into a server
       bundle), so server-side — and in the raw test builder — this is an inert no-op like
       `.refresh`; the SSR effect-strip leaves member calls intact, so an author `socket.watch(…)`
       reaching the server is a safe no-op. The real method is attached client-side by socketProxy. */
    watch(handler: (frame: T, context: CacheOnContext) => void | Promise<void>): () => void
}
