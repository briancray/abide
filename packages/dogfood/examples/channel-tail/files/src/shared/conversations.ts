import { channel } from 'abide'

export type Turn = { speaker: string; text: string }

// Three past messages, whatever a reader asks for.
export const turns = channel<Turn, { conversation: string }>({ tail: 3 })

const OPENING: Turn[] = [
    { speaker: 'you', text: 'How do I rotate an API key?' },
    { speaker: 'assistant', text: 'Settings, then Keys, then Rotate.' },
    { speaker: 'you', text: 'Does the old key keep working?' },
]

// A room is created by a publish, so the conversation opens with one.
const onboarding = turns({ conversation: 'onboarding' })
for (const turn of OPENING) onboarding.publish(turn)
