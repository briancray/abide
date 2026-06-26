import type { OutboxEntry } from './OutboxEntry.ts'

/*
The `.outbox` face on a durable RPC's client proxy: callable to read the reactive list
of undelivered entries (`rpc.outbox()`), with an awaitable `retry()` that drains the whole
queue and resolves when the replay settles. Server-side there is no client queue, so the
face is absent.
*/
export type Outbox<Args> = (() => OutboxEntry<Args>[]) & { retry: () => Promise<void> }
