import { reactive } from '@abide/abide'

/** One feed per account, shared by every caller; idle for an hour, let go. */
export const feeds = reactive(
    (_account: {
        account: string
    }): { id: string; kind: string; at: string }[] => [],
    {
        global: true,
        by: 'id',
        ttl: 3_600_000,
    },
)
