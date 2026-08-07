// The socket half of `both.ts`, and the one case where the two derivations read the message shape
// out of DIFFERENT places.
//
// `shape.ts` reads the call site — `socket<T, Args>`, so the message is the first argument.
// `checked.ts` reads the declaration's own type — `RoomChannel<Args, T>`, so the message is the
// SECOND. The two orders are reversed, each half hard-codes its own, and neither can see the other.
// Without a socket here that test never runs, and a rename of `RoomChannel` would publish the ROOM
// shape as the message gate — a 422 on publishes that were correct, which is the one direction a
// derived shape may not be wrong in.

import type { RoomChannel } from 'abide'
import { socket } from 'abide/server'

export const ticks = socket<{ n: number }>({ channel: { tail: 4 } })

// Annotated because the policy publishes into the socket it is declaring — the same shape
// `server/sockets/feed.ts` is forced into, and the one that exercises the reversal.
export const rooms: RoomChannel<{ room: string }, string> = socket<string, { room: string }>({
    channel: { tail: 4 },
    clientPublish: (message, room) => {
        rooms(room as { room: string }).publish(`echoed: ${message}`)
    },
})
