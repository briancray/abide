// The socket half of `both.ts`, and the one case where the two derivations read the message shape
// out of DIFFERENT places.
//
// `shape.ts` reads the call site — `socket<T, Args>`, so the message is the first argument.
// `checked.ts` reads the declaration's own type — `KeyedChannel<Args, T>`, so the message is the
// SECOND. The two orders are reversed, each half hard-codes its own, and neither can see the other.
// Without a socket here that test never runs, and a rename of `KeyedChannel` would publish the ROOM
// shape as the message gate — a 422 on publishes that were correct, which is the one direction a
// derived shape may not be wrong in.

import type { KeyedChannel } from 'abide'
import { socket } from 'abide/server'

export const ticks = socket<{ n: number }>({ channel: { tail: 4 } })

// Annotated ON PURPOSE, and this is the only place left that is: `clientPublish` hands the policy
// the room it is publishing into, so no app is forced to name the declaration it is inside. The
// annotation is still legal authoring, and it is the only spelling `checked.ts` can read the message
// out of — a fixture that dropped it would leave that half of the derivation untested.
export const rooms: KeyedChannel<{ room: string }, string> = socket<string, { room: string }>({
    channel: { tail: 4 },
    clientPublish: (message, _room, into) => {
        into.publish(`echoed: ${message}`)
    },
})
