import { rpc } from '@abide/abide/server'

export type Entry = { id: string; kind: string; at: string }

/** Answers at /activity/feed; one feed per account, every tab reading it follows it, idle for an hour, let go. */
export default rpc((_account: { account: string }): Entry[] => [], {
    global: true,
    ttl: 3_600_000,
    key: 'id',
    description: "An account's activity feed.",
})
