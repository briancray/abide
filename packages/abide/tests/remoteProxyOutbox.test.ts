import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { OutboxEntry } from '../src/lib/shared/types/OutboxEntry.ts'
import { remoteProxy } from '../src/lib/ui/remoteProxy.ts'
import { memoryStore } from './support/memoryStore.ts'

describe('durable remote proxy', () => {
    beforeEach(() => {
        ;(globalThis as { window?: unknown }).window = { location: { href: 'http://localhost/' } }
    })
    afterEach(() => {
        delete (globalThis as { window?: unknown }).window
    })

    test('a durable rpc call enqueues and exposes .outbox', () => {
        const save = remoteProxy<{ text: string }, void>('POST', '/rpc/saveMessageDurable', {
            outbox: true,
            store: memoryStore(),
            online: () => false, // stay offline so it does not drain during the test
        })
        const entry = save({ text: 'hi' }) as unknown as OutboxEntry<{ text: string }>
        expect(entry.args.text).toBe('hi')
        expect(save.outbox!().map((e) => e.args.text)).toEqual(['hi'])
        entry.controller.abort()
        expect(save.outbox!()).toHaveLength(0)
    })

    test('a non-durable proxy has no .outbox face', () => {
        const plain = remoteProxy<{ text: string }, void>('POST', '/rpc/plain')
        expect(plain.outbox).toBeUndefined()
    })
})
