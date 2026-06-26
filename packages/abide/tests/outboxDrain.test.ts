import { describe, expect, test } from 'bun:test'
import { createOutboxQueue } from '../src/lib/ui/rpcOutbox/createOutboxQueue.ts'
import { memoryStore } from './support/memoryStore.ts'

const req = () => new Request('http://localhost/rpc/x', { method: 'POST' })

describe('outbox drain', () => {
    test('drain sends FIFO and removes delivered entries', async () => {
        let count = 0
        const queue = createOutboxQueue<{ n: number }>({
            url: '/rpc/x',
            store: memoryStore(),
            send: async () => {
                count++
                return new Response(null, { status: 200 })
            },
        })
        queue.park({ n: 1 }, req())
        queue.park({ n: 2 }, req())
        await queue.drain()
        expect(count).toBe(2)
        expect(queue.entries()).toHaveLength(0)
        queue.dispose()
    })

    test('a still-unreachable resend (503) keeps the entry queued', async () => {
        const queue = createOutboxQueue<{ n: number }>({
            url: '/rpc/x',
            store: memoryStore(),
            send: async () => new Response('down', { status: 503 }),
        })
        queue.park({ n: 1 }, req())
        await queue.drain()
        expect(queue.entries()).toHaveLength(1)
        expect(queue.entries()[0]!.status).toBe('queued')
        queue.dispose()
    })

    test('a real non-2xx (422) on resend removes the entry — the server handled it', async () => {
        const queue = createOutboxQueue<{ n: number }>({
            url: '/rpc/x',
            store: memoryStore(),
            send: async () => new Response('nope', { status: 422 }),
        })
        queue.park({ n: 1 }, req())
        await queue.drain()
        expect(queue.entries()).toHaveLength(0) // a real response leaves the queue, no error state
        queue.dispose()
    })

    test('a rejected head leaves the queue and the next entry still sends (FIFO continues)', async () => {
        let calls = 0
        const queue = createOutboxQueue<{ n: number }>({
            url: '/rpc/x',
            store: memoryStore(),
            send: async () => {
                calls++
                return new Response('x', { status: calls === 1 ? 422 : 200 }) // head 422, next 2xx
            },
        })
        queue.park({ n: 1 }, req())
        queue.park({ n: 2 }, req())
        await queue.drain()
        expect(calls).toBe(2) // head rejected + removed, then the second resent
        expect(queue.entries()).toHaveLength(0) // both gone
        queue.dispose()
    })

    test('abort on a queued entry removes it without sending', async () => {
        let calls = 0
        const queue = createOutboxQueue<{ n: number }>({
            url: '/rpc/x',
            store: memoryStore(),
            send: async () => {
                calls++
                return new Response(null, { status: 200 })
            },
        })
        const entry = queue.park({ n: 1 }, req())
        entry.controller.abort()
        await queue.drain()
        expect(calls).toBe(0)
        expect(queue.entries()).toHaveLength(0)
        queue.dispose()
    })
})
