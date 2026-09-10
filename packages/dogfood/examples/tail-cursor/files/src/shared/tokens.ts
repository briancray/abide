import { state } from 'abide'

export type Token = { at: number; text: string }

// A number on the value, not an array beside it.
export const token = state<Token | undefined>(undefined, { tail: 200 })
