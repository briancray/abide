import { online as systemOnline } from '../../shared/online.ts'
import type { OutboxEntry, OutboxStatus } from '../../shared/types/OutboxEntry.ts'
import { effect } from '../effect.ts'
import { persist } from '../persist.ts'
import { createDoc as doc } from '../runtime/createDoc.ts'
import type { PersistenceStore } from '../types/PersistenceStore.ts'

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
so the queue IS a persisted document that survives a reload. `enqueue` records an
entry synchronously-durable and kicks a drain; the drain sends head-first while
`online()` holds — 2xx removes the entry, an offline mid-send keeps it for the next
reconnect, an online rejection marks it `error` (kept, visible), an abort removes it.
The send runs under the entry's OWN abort signal alone — scope-abort and the client
timeout are deliberately not composed in, so a durable write survives an unmount and
waits out offline. The live `AbortController` + `Request` per entry live in a side
map (they don't serialize) and are rebuilt from the persisted items on read, so a
reloaded entry gets a fresh controller. `cancel = entry.controller.abort()` removes
the entry via the abort listener wired here.
*/
export function createOutboxQueue<Args>(opts: {
    url: string
    send: (request: Request) => Promise<Response>
    store?: PersistenceStore
    online?: () => boolean
}): OutboxQueue<Args> {
    const online = opts.online ?? systemOnline
    const stored = doc({ items: [] as StoredEntry<Args>[] })
    const persistence = persist(stored, keyFor(opts.url), { store: opts.store, debounce: 0 })
    /* Live entries (controller + Request) by id, rebuilt from persisted items on read. */
    const live = new Map<string, OutboxEntry<Args>>()

    const items = (): StoredEntry<Args>[] => stored.read('items') as StoredEntry<Args>[]

    const remove = (id: string): void => {
        const index = items().findIndex((item) => item.id === id)
        if (index !== -1) {
            stored.remove(`items/${index}`)
            persistence.flush()
        }
        live.delete(id)
    }

    const setStatus = (id: string, status: OutboxStatus): void => {
        const index = items().findIndex((item) => item.id === id)
        if (index !== -1) {
            stored.replace(`items/${index}/status`, status)
            persistence.flush()
        }
    }

    /* Cancel = abort: aborting an entry's controller removes it from the queue. */
    const wireAbort = (entry: OutboxEntry<Args>): OutboxEntry<Args> => {
        entry.controller.signal.addEventListener('abort', () => remove(entry.id), { once: true })
        return entry
    }

    const toLive = (item: StoredEntry<Args>): OutboxEntry<Args> => {
        const existing = live.get(item.id)
        if (existing !== undefined) {
            return existing.status === item.status ? existing : { ...existing, status: item.status }
        }
        const entry = wireAbort({
            id: item.id,
            controller: new AbortController(),
            request: new Request(item.url, { method: item.method, body: item.body }),
            args: item.args,
            status: item.status,
        })
        live.set(item.id, entry)
        return entry
    }

    /* The send runs under the entry's OWN signal only — durable survives unmount +
       waits out offline, so scope-abort + client-timeout are NOT composed in. */
    const sendable = (entry: OutboxEntry<Args>): Request =>
        new Request(entry.request, { signal: entry.controller.signal })

    let draining = false
    let settled: Promise<void> = Promise.resolve()
    const drain = (): Promise<void> => {
        if (draining) {
            return settled
        }
        draining = true
        settled = (async () => {
            try {
                while (online()) {
                    const head = items().find((item) => item.status !== 'error')
                    if (head === undefined) {
                        break
                    }
                    const entry = toLive(head)
                    if (entry.controller.signal.aborted) {
                        remove(head.id) // canceled while queued
                        continue
                    }
                    setStatus(head.id, 'sending')
                    try {
                        const response = await opts.send(sendable(entry))
                        if (response.ok) {
                            remove(head.id)
                            continue
                        }
                        if (!online()) {
                            setStatus(head.id, 'queued') // went offline mid-send → retry later
                            break
                        }
                        setStatus(head.id, 'error') // online + rejected → permanent
                        break
                    } catch {
                        if (entry.controller.signal.aborted) {
                            remove(head.id) // canceled mid-send
                            continue
                        }
                        if (!online()) {
                            setStatus(head.id, 'queued')
                            break
                        }
                        setStatus(head.id, 'error')
                        break
                    }
                }
            } finally {
                draining = false
            }
        })()
        return settled
    }

    /* Re-drain whenever connectivity returns — reading `online()` subscribes this. */
    const stop = effect(() => {
        if (online()) {
            void drain()
        }
    })

    return {
        enqueue(args, request) {
            const id = crypto.randomUUID()
            const entry = wireAbort({
                id,
                controller: new AbortController(),
                request,
                args,
                status: 'queued',
            })
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
            void drain()
            return entry
        },
        entries() {
            return items().map(toLive)
        },
        drain,
        dispose() {
            stop()
            persistence.dispose()
        },
    }
}
