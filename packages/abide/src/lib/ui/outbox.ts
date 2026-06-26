import type { OutboxEntry } from '../shared/types/OutboxEntry.ts'
import type { RemoteFunction } from '../shared/types/RemoteFunction.ts'
import { outboxRegistry } from './rpcOutbox/outboxRegistry.ts'

/* One entry in the global outbox, tagged with the RPC it belongs to. */
export type GlobalOutboxEntry = OutboxEntry<unknown> & { rpc: RemoteFunction<unknown, unknown> }

/*
The global, reactive view of every durable RPC's outbox — a flat list of undelivered
entries across all `outbox: true` rpcs, each tagged with its `rpc`. Reactive: reading it
in a template/effect subscribes to each registered queue, so it updates as writes enqueue,
drain, fail, or cancel. Use it for an app-wide "N unsynced" badge or a sync panel, and
cancel any pending write through `entry.controller.abort()`. A single rpc's slice is
`rpc.outbox`. Server-side there are no client queues, so it returns an empty list.
*/
// @documentation ui
export function outbox(): GlobalOutboxEntry[] {
    return outboxRegistry.all().flatMap(({ rpc, queue }) =>
        queue.entries().map((entry) => ({
            ...entry,
            rpc: rpc as RemoteFunction<unknown, unknown>,
        })),
    )
}
