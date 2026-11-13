import { reactive } from '@abide/abide'

export type Call = { id: string; note: string }

/** The calls logged against Grace Hopper, shared by every caller. */
export const calls = reactive<Call[]>(
    [{ id: 'c1', note: 'Wants a quote by Friday.' }],
    { global: true, by: 'id' },
)
