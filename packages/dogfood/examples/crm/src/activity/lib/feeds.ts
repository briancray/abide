import { reactive } from '@abide/abide'

export type Entry = { id: string; kind: string; at: string }

/** One feed per account, shared by every caller; idle for an hour, let go. */
export const feeds = reactive((_account: { account: string }): Entry[] => [], {
    global: true,
    by: 'id',
    ttl: 3_600_000,
})
