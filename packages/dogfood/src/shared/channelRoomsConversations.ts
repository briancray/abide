import { reactive } from 'abide'

export type Turn = { id: number; speaker: string; text: string }

/** One declaration is every conversation the app will ever have. */
export const turns = reactive((_args: { conversation: string }): Turn[] => [], {
    by: 'id',
})
