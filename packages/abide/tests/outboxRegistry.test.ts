import { describe, expect, test } from 'bun:test'
import type { OutboxQueue } from '../src/lib/ui/rpcOutbox/createOutboxQueue.ts'
import { outboxRegistry } from '../src/lib/ui/rpcOutbox/outboxRegistry.ts'

describe('outboxRegistry', () => {
    test('register + get + all by url', () => {
        const queue = { enqueue: () => ({}) } as unknown as OutboxQueue<unknown>
        const rpc = { url: '/rpc/a' }
        outboxRegistry.register('/rpc/a', queue, rpc)
        expect(outboxRegistry.get('/rpc/a')).toBe(queue)
        expect(
            outboxRegistry.all().some((entry) => entry.url === '/rpc/a' && entry.rpc === rpc),
        ).toBe(true)
    })

    test('re-registering the same url keeps one entry', () => {
        const first = {} as OutboxQueue<unknown>
        const second = {} as OutboxQueue<unknown>
        outboxRegistry.register('/rpc/dup', first, {})
        outboxRegistry.register('/rpc/dup', second, {})
        expect(outboxRegistry.get('/rpc/dup')).toBe(second)
        expect(outboxRegistry.all().filter((entry) => entry.url === '/rpc/dup')).toHaveLength(1)
    })
})
