import { channel } from 'abide'
import { tooLong } from './failures.ts'

export type Turn = { speaker: string; text: string }

const LIMIT = 120

// Runs on every publish, the app's own included.
export const turns = channel<Turn, { conversation: string }>({
    transform: (turn) => {
        if (turn.text.length <= LIMIT) return turn
        return tooLong({ length: turn.text.length })
    },
})
