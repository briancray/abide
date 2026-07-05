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
    /* `broadcast` is the taught name — send a frame to every subscriber (server always;
       client only when `clientPublish` is set). `publish` is its retained alias through the
       migration. */
    broadcast(message: T): void
    publish(message: T): void
    tail(count?: number, hooks?: TailHooks): AsyncIterable<T>
}
