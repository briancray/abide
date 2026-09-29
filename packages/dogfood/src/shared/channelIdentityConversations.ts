import { reactive } from 'abide'

export type Turn = { speaker: string; text: string }

/** What makes it the same turn, which gates a set and never a publish. */
export const onboarding = reactive<Turn>(undefined, {
    history: 50,
    identity: (turn) => `${turn.speaker}: ${turn.text}`,
})
