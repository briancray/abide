// The other law, in the directory that says which law it is — so a compile embeds both kinds.
//
// Published at module load rather than on a timer: what a console tails is `channel.tail()`, and the
// transcript a late subscriber is caught up with is the one part of a socket a process that has to
// RETURN can assert. A timer would make the gate a race against its own interval.
import { socket } from 'abide/server'

export const pulse = socket<{ n: number }>({ channel: { tail: 4 } })

for (let n = 1; n <= 3; n++) pulse().publish({ n })
