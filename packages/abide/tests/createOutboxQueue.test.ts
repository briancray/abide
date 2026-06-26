import { describe, expect, test } from 'bun:test'
import { createOutboxQueue } from '../src/lib/ui/rpcOutbox/createOutboxQueue.ts'
import { memoryStore } from './support/memoryStore.ts'

describe('createOutboxQueue', () => {
    test('park records a queued entry, readable + persisted', () => {
        const store = memoryStore()
        const queue = createOutboxQueue<{ text: string }>({
            url: '/rpc/saveMessage',
            send: async () => new Response(null, { status: 200 }),
            store,
        })
        const request = new Request('http://localhost/rpc/saveMessage', { method: 'POST' })
        const entry = queue.park({ text: 'hi' }, request)
        expect(entry.status).toBe('queued')
        expect(typeof entry.retry).toBe('function')
        expect(queue.entries().map((e) => e.args.text)).toEqual(['hi'])
        expect(store.has('abide:outbox:/rpc/saveMessage')).toBe(true) // persisted under the rpc url
        queue.dispose()
    })

    test('park alone does not drain — the queue waits for retry()/drain()', async () => {
        let sent = 0
        const queue = createOutboxQueue<{ n: number }>({
            url: '/rpc/noAutoDrain',
            store: memoryStore(),
            send: async () => {
                sent++
                return new Response(null, { status: 200 })
            },
        })
        queue.park({ n: 1 }, new Request('http://localhost/rpc/noAutoDrain', { method: 'POST' }))
        await Promise.resolve()
        expect(sent).toBe(0) // nothing drains automatically
        expect(queue.entries()).toHaveLength(1)
        queue.dispose()
    })
})
