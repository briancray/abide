import { online as systemOnline } from '../../shared/online.ts'
import { persist } from '../persist.ts'
import { createDoc as doc } from '../runtime/createDoc.ts'
import type { PersistenceStore } from '../types/PersistenceStore.ts'
import type { OutboxEntry, OutboxStatus } from './OutboxEntry.ts'

/* Persisted form of an entry — the Request reduced to its replayable parts (a live
   Request + AbortController don't serialize). `body` is captured in a later task. */
type StoredEntry<Args> = {
    id: string
    args: Args
    method: string
    url: string
    body: string | undefined
    status: OutboxStatus
}

export type OutboxQueue<Args> = {
    enqueue: (args: Args, request: Request) => OutboxEntry<Args>
    entries: () => OutboxEntry<Args>[]
    drain: () => Promise<void>
    dispose: () => void
}

/* Persistence key per RPC url — the queue's durable identity. */
const keyFor = (url: string): string => `abide:outbox:${url}`

/*
A durable, app-owned FIFO mutation queue for one RPC. Built on `doc` + `persist`,
so the queue IS a persisted document that survives a reload. Entries are recorded
synchronously-durable on `enqueue`; the drain (added next) sends them head-first
while `online()` holds. The live `AbortController` + `Request` per entry are held in
a side map (they don't serialize) and rebuilt from the persisted items on read, so a
reloaded entry gets a fresh controller.
*/
export function createOutboxQueue<Args>(opts: {
    url: string
    send: (request: Request) => Promise<Response>
    store?: PersistenceStore
    online?: () => boolean
}): OutboxQueue<Args> {
    const stored = doc({ items: [] as StoredEntry<Args>[] })
    const persistence = persist(stored, keyFor(opts.url), { store: opts.store, debounce: 0 })
    /* Live entries (controller + Request) by id, rebuilt from persisted items on read. */
    const live = new Map<string, OutboxEntry<Args>>()

    const toLive = (item: StoredEntry<Args>): OutboxEntry<Args> => {
        const existing = live.get(item.id)
        if (existing !== undefined) {
            return existing.status === item.status ? existing : { ...existing, status: item.status }
        }
        const entry: OutboxEntry<Args> = {
            id: item.id,
            controller: new AbortController(),
            request: new Request(item.url, { method: item.method, body: item.body }),
            args: item.args,
            status: item.status,
        }
        live.set(item.id, entry)
        return entry
    }

    return {
        enqueue(args, request) {
            const id = crypto.randomUUID()
            const entry: OutboxEntry<Args> = {
                id,
                controller: new AbortController(),
                request,
                args,
                status: 'queued',
            }
            live.set(id, entry)
            stored.add('items/-', {
                id,
                args,
                method: request.method,
                url: request.url,
                body: undefined,
                status: 'queued',
            })
            persistence.flush()
            return entry
        },
        entries() {
            return (stored.read('items') as StoredEntry<Args>[]).map(toLive)
        },
        drain: async () => undefined, // implemented next task
        dispose() {
            persistence.dispose()
        },
    }
}

/* Referenced so an unused-import lint never trips before the drain task wires it. */
void systemOnline
