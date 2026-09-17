import { reactive } from 'abide'

export type Token = { at: number; text: string }

// A number on the value, not an array beside it.
export const token = reactive<Token>(undefined, { history: 200 })

// Three tokens before anyone reads, so there is a past to replay.
for (const at of [1, 2, 3]) token.publish({ at, text: `token ${at}` })
