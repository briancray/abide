import { channel } from 'abide'

export type Turn = { speaker: string; text: string }

// What makes it the same message, against the previous one alone.
export const turns = channel<Turn, { conversation: string }>({
    identity: (turn) => `${turn.speaker}: ${turn.text}`,
})
