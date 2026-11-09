// 31.9's gate: a list a page imports and pushes onto, one of them typed with `undefined`.
import { reactive } from '@abide/abide'

export type Draft = { id: number }
export const drafts = reactive<Draft[]>([])
export const pending = reactive<Draft[] | undefined>(undefined)
