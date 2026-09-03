import { channel, structural } from 'abide/server'
import { redisStore } from '#server/redisStore'

export type Member = { id: string; name: string }

// A channel's `Accepted` is ONE message, so a store round-trips the
// standing roster and never the tail — a restart restores the last
// one instead of showing an empty room until somebody publishes.
// A ROOM DEFAULTS TO THE REFERENCE, a publish being an event and
// two identical events two events — so unlike a state or a memo
// this one has to ask. It reads together with the store: a
// republished identical roster is not a production, so it is not
// written either.
export const roster = channel<Member[], { room: string }>({
    identity: structural,
    store: ({ room }) => redisStore(`roster:${room}`),
})
