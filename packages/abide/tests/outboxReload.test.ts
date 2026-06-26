import { describe, expect, test } from 'bun:test'
import { createOutboxQueue } from '../src/lib/ui/rpcOutbox/createOutboxQueue.ts'
import { memoryStore } from './support/memoryStore.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('outbox reload', () => {
    test('a queued entry survives a reload and replays with its body', async () => {
        const store = memoryStore()
        const body = JSON.stringify({ text: 'persist me' })

        // First "session": enqueue while offline, then drop the queue.
        const first = createOutboxQueue<{ text: string }>({
            url: '/rpc/reload',
            online: () => false,
            store,
            send: async () => new Response(null, { status: 200 }),
        })
        first.enqueue(
            { text: 'persist me' },
            new Request('http://localhost/rpc/reload', {
                method: 'POST',
                body,
                headers: { 'content-type': 'application/json' },
            }),
        )
        await tick() // let the async body capture persist
        first.dispose()

        // "Reload": a fresh queue over the same store, now online.
        let sentBody = ''
        let sentType = ''
        const second = createOutboxQueue<{ text: string }>({
            url: '/rpc/reload',
            online: () => true,
            store,
            send: async (request) => {
                sentBody = await request.text()
                sentType = request.headers.get('content-type') ?? ''
                return new Response(null, { status: 200 })
            },
        })
        expect(second.entries()[0]!.args.text).toBe('persist me')
        expect(second.entries()[0]!.controller.signal.aborted).toBe(false)
        await second.drain()
        expect(sentBody).toBe(body) // replayed with the original body
        expect(sentType).toBe('application/json')
        expect(second.entries()).toHaveLength(0)
    })
})
