// The other law's declaration, in the directory that says which law it is. The server half is
// `channel()` unchanged — served at `/__abide/socket/feed/ticks`.

import { socket } from 'abide/server'

export const ticks = socket<{ n: number }>({ channel: { tail: 8 } })

// `into` is the sender's own room, already resolved. Reaching it through the argument rather than
// through the name being declared is what keeps this an ordinary declaration — a policy that said
// `rooms(room)` would be reading a `const` mid-initialiser, which needs an annotation to have a type.
export const rooms = socket<string, { room: string }>({
    channel: { tail: 8 },
    clientPublish: (message, _room, into) => {
        into.publish(`echoed: ${message}`)
    },
})
