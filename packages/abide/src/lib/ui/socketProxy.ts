import { buildSocketOverChannel } from '../shared/buildSocketOverChannel.ts'
import { decodeRefJson } from '../shared/decodeRefJson.ts'
import { SOCKET_SEED } from '../shared/SOCKET_SEED.ts'
import type { Socket } from '../shared/types/Socket.ts'
import { getSocketChannel } from './socketChannel.ts'
import { watch } from './watch.ts'

/*
Client-side substitute for a server-declared Socket. The bundler emits
one call per socket export under `src/server/sockets/`: server target uses
defineSocket (real fan-out), browser target uses socketProxy (subscribe
over the multiplexed ws channel). Both paths produce identical Socket
shapes so user code reads the same on either side.

The Socket surface — bare iteration as the live stream, `.tail(n)` seeded
from the retained tail, `.publish` sending a server-validated `pub` frame —
is built by buildSocketOverChannel over the page's lazily-opened singleton
channel; this module only binds that builder to the browser channel so the
test harness can reuse the identical surface over its own channel.

Backpressure is unbounded — a slow consumer with a chatty socket will
grow the per-iterator buffer; bounded policies belong in a future
socketProxy API, not the wire layer.
*/
// @documentation plumbing
export function socketProxy<T>(name: string): Socket<T> {
    /* Warm-seed from the server's retained frame (shipped in `__SSR__.sockets`, drained into
       SOCKET_SEED by startClient before mount) so `peek(socket)` returns the SAME value the SSR
       render committed to instead of undefined on this not-yet-connected client — otherwise the two
       disagree and hydration discards the server markup. A frame that failed to serialize server-side
       simply isn't present, and the socket falls back to a cold peek. */
    const seeded = SOCKET_SEED[name]
    let initialFrame: T | undefined
    if (seeded !== undefined) {
        try {
            initialFrame = decodeRefJson(seeded) as T
        } catch {
            initialFrame = undefined
        }
    }
    const socket = buildSocketOverChannel<T>(name, getSocketChannel, initialFrame)
    /* Overwrite the shared builder's inert `.watch` with the real reaction sugar
       (`socket.watch(handler)` ≡ `watch(socket, handler)`). Attached here so the ui-only
       `watch` primitive never rides into a server bundle. */
    socket.watch = (handler) => watch(socket, handler)
    return socket
}
