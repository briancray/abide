import { reactive } from 'abide'

export type Token = { at: number; text: string }

/** The last four tokens; the array is the window. */
export const token = reactive<Token[]>([], { by: 'at' })
