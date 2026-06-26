import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { pending } from '../src/lib/shared/pending.ts'
import { remoteProxy } from '../src/lib/ui/remoteProxy.ts'
import { outboxRegistry } from '../src/lib/ui/rpcOutbox/outboxRegistry.ts'
import { memoryStore } from './support/memoryStore.ts'

const realFetch = globalThis.fetch

describe('pending() over the durable queue', () => {
    beforeEach(() => {
        ;(globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' } }
        /* The server is unreachable, so a durable call parks instead of delivering. */
        globalThis.fetch = (async () =>
            new Response('down', { status: 503 })) as unknown as typeof fetch
    })
    afterEach(() => {
        globalThis.fetch = realFetch
        delete (globalThis as { window?: unknown }).window
        outboxRegistry.reset() // app-scoped queues outlive a mount; clear between tests
    })

    test('a parked durable write is pending; exact-args narrows', async () => {
        const save = remoteProxy<{ id: number }, void>('POST', '/rpc/pendingOutbox', {
            outbox: true, // park on unreachable, drain only via retry()
            store: memoryStore(),
        })
        expect(pending(save)).toBe(false)

        await save({ id: 1 }).catch(() => {}) // unreachable → parks, throws
        expect(pending(save)).toBe(true) // a parked write counts as pending
        expect(pending(save, { id: 1 })).toBe(true) // exact match
        expect(pending(save, { id: 2 })).toBe(false) // a different call is not pending
    })

    test('a parked write counts toward the bare global pending()', async () => {
        const save = remoteProxy<{ id: number }, void>('POST', '/rpc/bareOutbox', {
            outbox: true,
            store: memoryStore(),
        })
        expect(pending()).toBe(false)
        await save({ id: 1 }).catch(() => {}) // unreachable → parks
        expect(pending()).toBe(true) // global activity spans the outbox, not just in-flight fetches
    })
})
