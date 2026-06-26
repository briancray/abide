import { describe, expect, test } from 'bun:test'
import { createOutboxQueue } from '../src/lib/ui/rpcOutbox/createOutboxQueue.ts'
import { memoryStore } from './support/memoryStore.ts'

const req = () => new Request('http://localhost/rpc/x', { method: 'POST' })

describe('outbox drain', () => {
    test('online drains FIFO and removes delivered entries', async () => {
        const sent: number = 0
        let count = 0
        const queue = createOutboxQueue<{ n: number }>({
            url: '/rpc/x',
            online: () => true,
            store: memoryStore(),
            send: async () => {
                count++
                return new Response(null, { status: 200 })
            },
        })
        queue.enqueue({ n: 1 }, req())
        queue.enqueue({ n: 2 }, req())
        await queue.drain()
        expect(count).toBe(2)
        expect(queue.entries()).toHaveLength(0)
        void sent
        queue.dispose()
    })

    test('an online rejection marks the entry error and keeps it', async () => {
        const queue = createOutboxQueue<{ n: number }>({
            url: '/rpc/x',
            online: () => true,
            store: memoryStore(),
            send: async () => new Response('nope', { status: 422 }),
        })
        queue.enqueue({ n: 1 }, req())
        await queue.drain()
        expect(queue.entries()).toHaveLength(1)
        expect(queue.entries()[0]!.status).toBe('error')
        queue.dispose()
    })

    test('abort on a queued entry removes it without sending', async () => {
        let calls = 0
        const queue = createOutboxQueue<{ n: number }>({
            url: '/rpc/x',
            online: () => false,
            store: memoryStore(),
            send: async () => {
                calls++
                return new Response(null, { status: 200 })
            },
        })
        const entry = queue.enqueue({ n: 1 }, req())
        entry.controller.abort()
        await queue.drain()
        expect(calls).toBe(0)
        expect(queue.entries()).toHaveLength(0)
        queue.dispose()
    })
})
