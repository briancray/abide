import { reactive } from '@abide/abide'
import { tooLong } from '#shared/channelTransformFailures.ts'

export type Turn = { speaker: string; text: string }

const LIMIT = 120

/** Runs on every write: the turn just added is the one it checks. */
export const onboarding = reactive([] as Turn[], {
    transform: (turns: Turn[]) => {
        const last = turns.at(-1)
        if (last === undefined || last.text.length <= LIMIT) return turns
        return tooLong({ length: last.text.length })
    },
})
