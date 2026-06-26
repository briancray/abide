import { describe, expect, test } from 'bun:test'
import type { RemoteFunction } from '../src/lib/shared/types/RemoteFunction.ts'
import { outbox } from '../src/lib/ui/outbox.ts'
import { createOutboxQueue, type OutboxQueue } from '../src/lib/ui/rpcOutbox/createOutboxQueue.ts'
import { outboxRegistry } from '../src/lib/ui/rpcOutbox/outboxRegistry.ts'
import { memoryStore } from './support/memoryStore.ts'

const queueFor = (url: string) =>
    createOutboxQueue<{ n: number }>({
        url,
        store: memoryStore(),
        send: async () => new Response(null, { status: 200 }),
    })

describe('global outbox() aggregate', () => {
    test('flattens entries across durable rpcs, each tagged with its rpc', () => {
        const queueA = queueFor('/rpc/aggA')
        const queueB = queueFor('/rpc/aggB')
        const rpcA = { url: '/rpc/aggA' } as unknown as RemoteFunction<unknown, unknown>
        const rpcB = { url: '/rpc/aggB' } as unknown as RemoteFunction<unknown, unknown>
        outboxRegistry.register('/rpc/aggA', queueA as OutboxQueue<unknown>, rpcA)
        outboxRegistry.register('/rpc/aggB', queueB as OutboxQueue<unknown>, rpcB)

        queueA.park({ n: 1 }, new Request('http://localhost/rpc/aggA', { method: 'POST' }))
        queueB.park({ n: 2 }, new Request('http://localhost/rpc/aggB', { method: 'POST' }))

        /* Filter to this test's rpcs — the registry is a process-wide singleton. */
        const mine = outbox().filter((entry) => entry.rpc === rpcA || entry.rpc === rpcB)
        expect(mine).toHaveLength(2)
        expect(mine.find((entry) => entry.rpc === rpcA)?.args).toEqual({ n: 1 })
        expect(mine.every((entry) => typeof entry.controller.abort === 'function')).toBe(true)
        expect(mine.every((entry) => typeof entry.retry === 'function')).toBe(true)
    })

    test('outbox.retry() is callable (drains every registered queue)', () => {
        expect(typeof outbox.retry).toBe('function')
        expect(() => outbox.retry()).not.toThrow()
    })
})
