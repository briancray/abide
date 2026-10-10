import { reactive } from 'abide'

export type Turn = { id: number; speaker: string; text: string }

/** The last three turns: the room trims itself as it grows. */
export const onboarding = reactive<Turn[]>(
    [
        { id: 1, speaker: 'you', text: 'How do I rotate an API key?' },
        {
            id: 2,
            speaker: 'assistant',
            text: 'Settings, then Keys, then Rotate.',
        },
        { id: 3, speaker: 'you', text: 'Does the old key keep working?' },
    ],
    { by: 'id' },
)

/** Appends a turn and lets the oldest go past three. */
export function say(speaker: string, text: string): void {
    onboarding.patch((turns) => {
        turns.push({ id: (turns.at(-1)?.id ?? 0) + 1, speaker, text })
        if (turns.length > 3) turns.shift()
    })
}
