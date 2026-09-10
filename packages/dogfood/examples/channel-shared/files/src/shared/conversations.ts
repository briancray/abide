import { channel } from 'abide'

export type Turn = { speaker: string; text: string }

export const turns = channel<Turn, { conversation: string }>()
