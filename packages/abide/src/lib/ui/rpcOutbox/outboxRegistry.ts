import { canonicalJson } from '../../shared/canonicalJson.ts'
import { outboxProbeSlot } from '../../shared/outboxProbeSlot.ts'
import type { OutboxQueue } from './createOutboxQueue.ts'

/* One registered durable RPC: its url, the RemoteFunction it belongs to (tag for the
   global aggregate), and its live queue. */
type RegisteredOutbox = { url: string; rpc: unknown; queue: OutboxQueue<unknown> }

/*
Client registry of every durable RPC's outbox queue, keyed by url. A durable RPC
(`outbox: true`) registers on first use so the global `outbox()` aggregate can
flatten every queue and `pending()` can see queued entries. App-scoped, not component-
scoped — the queues outlive any mount.
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
    /* Drop every registered queue. App-scoped state outlives any mount, so tests that
       park writes share one process-global registry; reset() gives each its own clean
       slate. Only the in-memory registry is dropped — `queue.dispose()` keeps the
       persisted snapshot (a reload rehydrates it), so a sign-out that must abandon
       unsynced work has to clear persistence separately. */
    reset(): void {
        for (const { queue } of registered.values()) {
            queue.dispose?.()
        }
        registered.clear()
    },
}

/* The queues a pending() selector spans: a durable rpc selector carries the queue's
   `url`, so it narrows to that one; the bare form spans every registered queue; any
   other selector (producer fn, tags, subscribable) carries no url and matches none. */
const queuesFor = (selector: unknown): OutboxQueue<unknown>[] => {
    if (selector === undefined) {
        return outboxRegistry.all().map(({ queue }) => queue)
    }
    const url = (selector as { url?: unknown }).url
    if (typeof url !== 'string') {
        return []
    }
    const queue = outboxRegistry.get(url)
    return queue === undefined ? [] : [queue]
}

/* Prober for the shared pending() probe (see outboxProbeSlot). A parked write has no
   value yet, so it counts as pending. Reads queue.entries() (doc-backed), so the probe
   re-runs as writes park, drain, fail, or cancel; optional args narrow to one parked
   call by structural compare — the double-submit guard for a form. The compare uses
   canonicalJson (key-sorted, the encoder keyForRemoteCall keys body args with), not
   JSON.stringify, so a selector's args match a parked entry regardless of key order —
   the same equality the cache-side selector grammar already uses. */
outboxProbeSlot.probe = (selector, args): boolean => {
    const entries = queuesFor(selector).flatMap((queue) => queue.entries())
    if (args === undefined) {
        return entries.length > 0
    }
    const key = canonicalJson(args)
    return entries.some((entry) => canonicalJson(entry.args) === key)
}
