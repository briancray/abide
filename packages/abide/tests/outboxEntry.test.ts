import { describe, expect, test } from 'bun:test'
import type { OutboxEntry } from '../src/lib/shared/types/OutboxEntry.ts'

describe('OutboxEntry', () => {
    test('shape carries id, controller, request, args, status, retry, settled', async () => {
        let retried = false
        const entry: OutboxEntry<{ text: string }> = {
            id: 'x',
            controller: new AbortController(),
            request: new Request('http://localhost/rpc/x', { method: 'POST' }),
            args: { text: 'hi' },
            status: 'queued',
            retry: async () => {
                retried = true
            },
            settled: Promise.resolve(undefined),
        }
        expect(entry.status).toBe('queued')
        expect(entry.controller.signal.aborted).toBe(false)
        await entry.retry()
        expect(retried).toBe(true)
        await expect(entry.settled).resolves.toBeUndefined()
    })
})
