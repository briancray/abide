import { online as systemOnline } from '../shared/online.ts'
import { effect } from './effect.ts'
import { persist } from './persist.ts'
import { createDoc as doc } from './runtime/createDoc.ts'
import type { Outbox } from './types/Outbox.ts'
import type { PersistenceStore } from './types/PersistenceStore.ts'

/* One queued mutation: a stable id plus the serializable payload to replay. */
type OutboxEntry<T> = { id: string; payload: T }

/*
A durable, FIFO mutation queue for local-first writes. Built on `doc` + `persist`,
so the queue IS a persisted document — it survives a reload with no extra
machinery — and on the patch bus the same as everything else. `enqueue` appends a
payload and tries to drain; the drain sends entries head-first while `online()`
holds:
  - success → dequeue and continue;
  - rejected while now offline → keep the head, retry when connectivity returns
    (the effect below re-drains on the online edge);
  - rejected while still online → a real server/validation failure: drop the entry
    so the queue can't wedge, and report it via `onDrop` so the caller can roll back
    the optimistic change it applied (e.g. `history().undo()` or a `cache.patch`).
Delivery is at-least-once (a crash between a successful send and its dequeue
re-sends on reload), so `send` should be idempotent. Reconnect RESYNC of reads is
`cache.on`'s job, not this. Client-intended: `send` performs a network mutation.
*/
// @readme plumbing
export function outbox<T>({
    key,
    send,
    store,
    online = systemOnline,
    onDrop,
}: {
    key: string
    send: (payload: T) => Promise<void>
    store?: PersistenceStore
    online?: () => boolean
    onDrop?: (payload: T, error: unknown) => void
}): Outbox<T> {
    const queue = doc({ items: [] as OutboxEntry<T>[] })
    /* `debounce: 0` because the queue writes itself synchronously below — a queued
       mutation must be durable the instant it's recorded, not after a debounce
       window where a crash could lose it. */
    const persistence = persist(queue, key, { store, debounce: 0 })
    /* Drop the head and make the dequeue durable at once, so a reload never re-sends
       an entry already acknowledged. */
    const dequeue = (): void => {
        queue.remove('items/0')
        persistence.flush()
    }

    /* At most one drain runs at a time; `settled` lets a caller await the active one.
       A drain re-reads the queue each step, so entries enqueued mid-drain are picked
       up by the running loop. An empty drain finishes synchronously (it hits no
       `await`), so `draining` is back to false before the next `enqueue` — there is no
       resolved-but-still-flagged window for a new entry to fall into. */
    let draining = false
    let settled: Promise<void> = Promise.resolve()
    const flush = (): Promise<void> => {
        if (draining) {
            return settled
        }
        draining = true
        settled = (async () => {
            try {
                while (online()) {
                    const { items } = queue.snapshot() as { items: OutboxEntry<T>[] }
                    const head = items[0]
                    if (head === undefined) {
                        break
                    }
                    try {
                        await send(head.payload)
                    } catch (error) {
                        /* Went offline mid-send → keep the head, retry on reconnect. */
                        if (!online()) {
                            break
                        }
                        /* Online but rejected → permanent: drop it, report for rollback. */
                        dequeue()
                        onDrop?.(head.payload, error)
                        continue
                    }
                    dequeue()
                }
            } finally {
                draining = false
            }
        })()
        return settled
    }

    /* Re-drain whenever connectivity returns — reading `online()` subscribes this
       effect, so the offline→online edge fires it. */
    const stop = effect(() => {
        if (online()) {
            void flush()
        }
    })

    return {
        enqueue: (payload: T) => {
            queue.add('items/-', { id: crypto.randomUUID(), payload })
            persistence.flush() // durable before we attempt the network
            void flush()
        },
        pending: () => (queue.read('items') as OutboxEntry<T>[]).map((entry) => entry.payload),
        flush,
        dispose: () => {
            stop()
            persistence.dispose()
        },
    }
}
