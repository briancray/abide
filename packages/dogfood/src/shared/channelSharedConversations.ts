import { reactive } from '@abide/abide'

export type Turn = { id: number; speaker: string; text: string }

/** Empty until somebody speaks, and anything that imports it may. */
export const onboarding = reactive<Turn[]>([], { by: 'id' })
