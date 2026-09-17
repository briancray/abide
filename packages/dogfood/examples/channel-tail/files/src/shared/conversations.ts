import { reactive } from 'abide'

export type Turn = { speaker: string; text: string }

// The latest turn and two before it, whatever a reader asks for.
export const onboarding = reactive<Turn>(undefined, { history: 2 })

const OPENING: Turn[] = [
    { speaker: 'you', text: 'How do I rotate an API key?' },
    { speaker: 'assistant', text: 'Settings, then Keys, then Rotate.' },
    { speaker: 'you', text: 'Does the old key keep working?' },
]

// The conversation opens with three publishes, so it has a past to show.
for (const turn of OPENING) onboarding.publish(turn)
