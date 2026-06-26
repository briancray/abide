import type { OutboxEntry } from '../shared/types/OutboxEntry.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'
import { outboxRegistry } from './rpcOutbox/outboxRegistry.ts'

/* One entry in the global outbox, tagged with the RPC it belongs to. */
export type GlobalOutboxEntry = OutboxEntry<unknown> & { rpc: RemoteFunction<unknown, unknown> }

/* The global outbox: callable for the flat entry list, awaitable `retry()` to drain every
   queue (resolves when every replay settles). */
export type GlobalOutbox = (() => GlobalOutboxEntry[]) & { retry: () => Promise<void> }

function list(): GlobalOutboxEntry[] {
    return outboxRegistry.all().flatMap(({ rpc, queue }) =>
        queue.entries().map((entry) => ({
            ...entry,
            rpc: rpc as RemoteFunction<unknown, unknown>,
        })),
    )
}

/*
The global, reactive view of every durable RPC's outbox — a flat list of undelivered
entries across all `outbox` rpcs, each tagged with its `rpc`. Reactive: reading it in a
template/effect subscribes to each registered queue, so it updates as writes park, drain,
fail, or cancel. Use it for an app-wide "N unsynced" badge or a sync panel; cancel a
pending write through `entry.controller.abort()`, retry one through `entry.retry()`, or
drain everything through `outbox.retry()`. A single rpc's slice is `rpc.outbox`. Server-
side there are no client queues, so it returns an empty list.
*/
// @documentation ui
export const outbox: GlobalOutbox = Object.assign(list, {
    async retry(): Promise<void> {
        await Promise.all(outboxRegistry.all().map(({ queue }) => queue.retry()))
    },
})
