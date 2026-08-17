// The other law's declaration, in the directory that says which law it is. The server half is
// `channel()` unchanged — served at `/__abide/socket/feed/ticks`.

import { socket } from 'abide/server'

/**
 * A `GET` is a `memo` whose body is a fetch; this is a `channel` whose subscribers arrived over a
 * wire — the same declaration, and the server half is `channel()` unchanged.
 *
 * So `ticks()` on a client is the read every other source spells the same way, and `tail` means here
 * exactly what it means on a local channel: how many messages a late subscriber is caught up with.
 */
export const ticks = socket<{ n: number }>({ channel: { tail: 8 } })

/**
 * Declaring an argument keys it, exactly as it keys a `GET` — one connection per room rather than one
 * per process. `clientPublish` is what makes the wire two-way; without it a browser may only listen.
 *
 * `into` is the sender's own room, already resolved. Reaching it through the argument rather than
 * through the name being declared is what keeps this an ordinary declaration — a policy that said
 * `rooms(room)` would be reading a `const` mid-initialiser, which needs an annotation to have a type.
 */
export const rooms = socket<string, { room: string }>({
    channel: { tail: 8 },
    clientPublish: (message, _room, into) => {
        into.publish(`echoed: ${message}`)
    },
})
