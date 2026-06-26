import type { OutboxQueue } from './createOutboxQueue.ts'

/* One registered durable RPC: its url, the RemoteFunction it belongs to (tag for the
   global aggregate), and its live queue. */
type RegisteredOutbox = { url: string; rpc: unknown; queue: OutboxQueue<unknown> }

/*
Client registry of every durable RPC's outbox queue, keyed by url. A durable RPC
(`outbox: true`) registers on first use so the global `outbox()` aggregate can flatten
every queue and `pending()` can see queued entries. App-scoped, not component-scoped —
the queues outlive any mount.
*/
const registered = new Map<string, RegisteredOutbox>()

export const outboxRegistry = {
    register(url: string, queue: OutboxQueue<unknown>, rpc: unknown): void {
        registered.set(url, { url, rpc, queue })
    },
    get(url: string): OutboxQueue<unknown> | undefined {
        return registered.get(url)?.queue
    },
    all(): RegisteredOutbox[] {
        return [...registered.values()]
    },
}
