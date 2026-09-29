import { reactive } from 'abide'

export type Turn = { speaker: string; text: string }

/** `undefined` until somebody publishes, and anything that imports it may. */
export const onboarding = reactive<Turn>(undefined, { history: 50 })
