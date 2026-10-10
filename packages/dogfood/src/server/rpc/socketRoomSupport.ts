import { GET, POST, reactive } from '@abide/abide/server'

type Turn = { id: string; speaker: string; text: string }

/** A support room per id; one nobody has posted to for an hour is let go. */
const rooms = reactive(
    (_room: { id: string }): Turn[] => [
        {
            id: 'greeting',
            speaker: 'support',
            text: 'Ask about any invoice here.',
        },
    ],
    { global: true, by: 'id', ttl: 3_600_000 },
)

/** Read, and followed by every tab reading it. */
export const room = GET(rooms, { description: "A support room's turns." })

/** The server writes the turn, so what a tab sends is only its text. */
export const say = POST(
    ({ id, text }: { id: string; text: string }) => {
        rooms({ id }).patch((turns) => {
            turns.push({ id: crypto.randomUUID(), speaker: 'you', text })
            if (turns.length > 20) turns.shift()
        })
    },
    { description: 'Says something in a support room.' },
)
