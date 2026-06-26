import { describe, expect, test } from 'bun:test'
import { createOutboxQueue } from '../src/lib/ui/rpcOutbox/createOutboxQueue.ts'
import { memoryStore } from './support/memoryStore.ts'

describe('createOutboxQueue', () => {
    test('enqueue records a queued entry, readable + persisted', () => {
        const store = memoryStore()
        const queue = createOutboxQueue<{ text: string }>({
            url: '/rpc/saveMessage',
            send: async () => new Response(null, { status: 200 }),
            store,
            online: () => false, // stay offline so it does not drain
        })
        const request = new Request('http://localhost/rpc/saveMessage', { method: 'POST' })
        const entry = queue.enqueue({ text: 'hi' }, request)
        expect(entry.status).toBe('queued')
        expect(queue.entries().map((e) => e.args.text)).toEqual(['hi'])
        expect(store.has('abide:outbox:/rpc/saveMessage')).toBe(true) // persisted under the rpc url
        queue.dispose()
    })
})
