import { reactive, socket } from 'abide/server'

type Turn = { speaker: string; text: string }

/** A support room per id, each opening on the same greeting. */
const rooms = reactive(
    (_room: { id: string }): Turn => ({
        speaker: 'support',
        text: 'Ask about any invoice here.',
    }),
    // A room nobody has posted to for an hour is let go.
    { history: 20, global: true, ttl: 3_600_000 },
)

/** Every room, which any tab holding its id may post to. */
export default socket(rooms, { clientPublish: true })
