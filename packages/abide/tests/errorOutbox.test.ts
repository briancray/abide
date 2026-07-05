import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { pending } from '../src/lib/shared/pending.ts'
import { remoteProxy } from '../src/lib/ui/remoteProxy.ts'
import { outboxRegistry } from '../src/lib/ui/rpcOutbox/outboxRegistry.ts'
import { memoryStore } from './support/memoryStore.ts'

const realFetch = globalThis.fetch

/* A parked durable write is pending-retry, not a failure — the `kind: 'queued'` sentinel is
   NOT recorded as an error, so fn.error() stays undefined while pending() reflects the park. */
describe('fn.error() over the durable queue', () => {
    beforeEach(() => {
        ;(globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' } }
        globalThis.fetch = (async () =>
            new Response('down', { status: 503 })) as unknown as typeof fetch
    })
    afterEach(() => {
        globalThis.fetch = realFetch
        delete (globalThis as { window?: unknown }).window
        outboxRegistry.reset()
    })

    test('a parked durable write is pending, not errored', async () => {
        const save = remoteProxy<{ id: number }, void>('POST', '/rpc/errorOutbox', {
            outbox: true,
            store: memoryStore(),
        })
        expect(save.error()).toBeUndefined()
        await save({ id: 1 }).catch(() => {}) // unreachable → parks (queued sentinel), throws
        expect(pending(save)).toBe(true) // pending covers the parked write
        expect(save.error()).toBeUndefined() // queued ≠ failed — no recorded error
    })
})
