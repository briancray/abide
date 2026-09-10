import { channel } from 'abide'

export type Turn = { speaker: string; text: string }

// One declaration is every conversation the app will ever have.
export const turns = channel<Turn, { conversation: string }>()
