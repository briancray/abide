import { reactive } from 'abide'
import { tooLong } from '#shared/channelTransformFailures.ts'

export type Turn = { speaker: string; text: string }

const LIMIT = 120

// Runs on every publish, the app's own included.
export const onboarding = reactive(undefined, {
    history: 50,
    transform: (turn: Turn) => {
        if (turn.text.length <= LIMIT) return turn
        return tooLong({ length: turn.text.length })
    },
})
