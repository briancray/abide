import type { StandardSchemaV1 } from '../shared/types/StandardSchemaV1.ts'
import type { Socket } from './sockets/types/Socket.ts'
import type { SocketOptions } from './sockets/types/SocketOptions.ts'

/*
Declares a Socket inside a file under `src/server/sockets/`. Each file contains
exactly one export, named after the file (e.g. `chat.ts` →
`export const chat = socket<ChatMessage>(...)`). The bundler reads the
// @documentation sockets
export name from the filename and the socket name from the file path
under `src/server/sockets/`, then rewrites this call to bind the name into the
runtime implementation (defineSocket on the server, socketProxy on the
client). Opts (tail, clientPublish, schema, clients) live on the
server side only; the client target discards them.

When `schema` is set, `T` infers from `InferOutput<Schema>` and publish
payloads validate against it on the server. `clients` controls which
adapter surfaces (browser / mcp / cli) advertise the socket — defaults
to browser-only when schemaless, all surfaces when a schema is present.

This function exists only for the type signature; calling it directly
means the bundler plugin didn't process the file, which throws.
*/
export function socket<Schema extends StandardSchemaV1>(
    opts: SocketOptions<Schema> & { schema: Schema },
): Socket<StandardSchemaV1.InferOutput<Schema>>
export function socket<T = unknown>(opts?: SocketOptions): Socket<T>
export function socket<T = unknown>(_opts?: SocketOptions): Socket<T> {
    throw new Error(
        '[abide] `socket(...)` was called outside an $sockets module — the socket helper is only valid as the value of `export const <filename> = ...` inside a file under src/server/sockets/',
    )
}
