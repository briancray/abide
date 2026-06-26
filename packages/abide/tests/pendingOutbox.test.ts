import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { pending } from '../src/lib/shared/pending.ts'
import { remoteProxy } from '../src/lib/ui/remoteProxy.ts'
import { memoryStore } from './support/memoryStore.ts'

describe('pending() over the durable queue', () => {
    beforeEach(() => {
        ;(globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' } }
    })
    afterEach(() => {
        delete (globalThis as { window?: unknown }).window
    })

    test('a queued durable write is pending (in-flight OR queued); exact-args narrows', () => {
        const save = remoteProxy<{ id: number }, void>('POST', '/rpc/pendingOutbox', {
            outbox: true,
            store: memoryStore(),
            online: () => false, // stay queued, never drains
        })
        expect(pending(save)).toBe(false)

        save({ id: 1 })
        expect(pending(save)).toBe(true) // queued counts as pending
        expect(pending(save, { id: 1 })).toBe(true) // exact match
        expect(pending(save, { id: 2 })).toBe(false) // a different call is not pending
    })
})
