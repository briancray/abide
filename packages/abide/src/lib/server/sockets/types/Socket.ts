import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { TailHooks } from '../../../shared/types/TailHooks.ts'

/*
Bidirectional named broadcast primitive. Declared once with `socket<T>()`
inside a file under `src/server/sockets/`; the same import resolves to a server-side
fan-out and a client-side ws proxy by build target. Iterating the socket
is the live stream — no replay. `.tail(count)` opens a subscription seeded
with the last `count` frames of the retained tail (declared via
`{ tail: n }`; no-arg = the whole retained tail) before going live — the
optional Subscribable retention capability the reactive `tail()` consumer
seeds from. `publish` is isomorphic: server code publishes in-process
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
    /* Drop local frames and re-pull the server's retained tail — the socket analog of
       getFoo.refresh(), for a ttl-expired frame or a reconnect resync. Server-side it is a
       no-op (the server IS the source). */
    refresh(): void
}
