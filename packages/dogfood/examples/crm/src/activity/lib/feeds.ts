import { memo, reactive } from '@abide/abide'

export type Entry = { id: string; kind: string; at: string }

/** One feed per account, shared by every caller; idle for an hour, let go. */
export const feeds = memo(
    (_account: { account: string }) => reactive<Entry[]>([], { key: 'id' }),
    { global: true, ttl: 3_600_000 },
)
