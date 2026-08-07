// The other law's declaration, in the directory that says which law it is. The server half is
// `channel()` unchanged — served at `/__abide/socket/feed/ticks`.

import type { RoomChannel } from 'abide'
import { socket } from 'abide/server'

export const ticks = socket<{ n: number }>({ channel: { tail: 8 } })

// Annotated because the policy publishes into the socket it is declaring: a declaration that reads
// its own name needs a type to stand on while it is being written.
export const rooms: RoomChannel<{ room: string }, string> = socket<string, { room: string }>({
    channel: { tail: 8 },
    clientPublish: (message, room) => {
        rooms(room as { room: string }).publish(`echoed: ${message}`)
    },
})
