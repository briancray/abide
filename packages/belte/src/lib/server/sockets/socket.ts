import type { Socket } from './types/Socket.ts'
import type { SocketOptions } from './types/SocketOptions.ts'

/*
Declares a Socket inside a file under `src/server/sockets/`. Each file contains
exactly one export, named after the file (e.g. `chat.ts` →
`export const chat = socket<ChatMessage>(...)`). The bundler reads the
export name from the filename and the socket name from the file path
under `src/server/sockets/`, then rewrites this call to bind the name into the
runtime implementation (defineSocket on the server, socketProxy on the
client). Opts (history, clientPublish) live on the server side only;
the client target discards them.

This function exists only for the type signature; calling it directly
means the bundler plugin didn't process the file, which throws.
*/
export function socket<T = unknown>(_opts?: SocketOptions): Socket<T> {
    throw new Error(
        '[belte] `socket(...)` was called outside an $sockets module — the socket helper is only valid as the value of `export const <filename> = ...` inside a file under src/server/sockets/',
    )
}
