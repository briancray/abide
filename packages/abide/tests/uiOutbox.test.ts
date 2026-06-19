import { describe, expect, test } from 'bun:test'
import { outbox } from '../src/lib/ui/outbox.ts'
import { state } from '../src/lib/ui/state.ts'
import type { PersistenceStore } from '../src/lib/ui/types/PersistenceStore.ts'

const memoryStore = (): PersistenceStore & { data: Map<string, unknown> } => {
    const data = new Map<string, unknown>()
    return {
        data,
        load: (key) => data.get(key),
        save: (key, snapshot) => data.set(key, structuredClone(snapshot)),
        remove: (key) => data.delete(key),
    }
}

/* Let the fire-and-forget drain settle (microtasks for each send). */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('outbox — local-first mutation queue', () => {
    test('online: queued mutations send FIFO and drain', async () => {
        const sent: string[] = []
        const box = outbox<string>({
            key: 'q',
            store: memoryStore(),
            online: () => true,
            send: async (payload) => {
                sent.push(payload)
            },
        })

        box.enqueue('a')
        box.enqueue('b')
        await box.flush()

        expect(sent).toEqual(['a', 'b'])
        expect(box.pending()).toEqual([])
        box.dispose()
    })

    test('offline holds the queue; reconnect auto-drains it', async () => {
        const sent: string[] = []
        const net = state(false)
        const box = outbox<string>({
            key: 'q',
            store: memoryStore(),
            online: () => net.value,
            send: async (payload) => {
                sent.push(payload)
            },
        })

        box.enqueue('a')
        box.enqueue('b')
        await box.flush()
        expect(sent).toEqual([]) // offline → nothing sent
        expect(box.pending()).toEqual(['a', 'b'])

        net.value = true // reconnect edge fires the effect; no manual flush
        await settle()
        expect(sent).toEqual(['a', 'b'])
        expect(box.pending()).toEqual([])
        box.dispose()
    })

    test('the queue is durable: a fresh outbox replays what was left unsent', async () => {
        const store = memoryStore()

        // session 1: offline, enqueue, leave
        const first = outbox<string>({
            key: 'q',
            store,
            online: () => false,
            send: async () => undefined,
        })
        first.enqueue('a')
        await first.flush()
        first.dispose()
        expect(store.data.has('q')).toBe(true) // persisted while offline

        // session 2: a reload, now online — the restored entry drains
        const sent: string[] = []
        const second = outbox<string>({
            key: 'q',
            store,
            online: () => true,
            send: async (payload) => {
                sent.push(payload)
            },
        })
        await second.flush()
        expect(sent).toEqual(['a'])
        expect(second.pending()).toEqual([])
        second.dispose()
    })

    test('an online rejection drops the entry and reports it, without wedging the queue', async () => {
        const sent: string[] = []
        const dropped: string[] = []
        const box = outbox<string>({
            key: 'q',
            store: memoryStore(),
            online: () => true,
            send: async (payload) => {
                if (payload === 'bad') {
                    throw new Error('422')
                }
                sent.push(payload)
            },
            onDrop: (payload) => {
                dropped.push(payload)
            },
        })

        box.enqueue('bad')
        box.enqueue('good')
        await box.flush()

        expect(dropped).toEqual(['bad']) // permanent failure rolled back to the caller
        expect(sent).toEqual(['good']) // queue kept draining past it
        expect(box.pending()).toEqual([])
        box.dispose()
    })

    test('going offline mid-send keeps the head for retry on reconnect', async () => {
        const sent: string[] = []
        const net = state(true)
        let firstTry = true
        const box = outbox<string>({
            key: 'q',
            store: memoryStore(),
            online: () => net.value,
            send: async (payload) => {
                if (firstTry) {
                    firstTry = false
                    net.value = false // connection drops during the send
                    throw new Error('network')
                }
                sent.push(payload)
            },
        })

        box.enqueue('a')
        await box.flush()
        expect(sent).toEqual([]) // the send failed and we went offline
        expect(box.pending()).toEqual(['a']) // head retained, not dropped

        net.value = true // reconnect → retry succeeds
        await settle()
        expect(sent).toEqual(['a'])
        expect(box.pending()).toEqual([])
        box.dispose()
    })
})
