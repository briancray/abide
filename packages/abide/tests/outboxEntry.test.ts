import { describe, expect, test } from 'bun:test'
import type { OutboxEntry } from '../src/lib/ui/rpcOutbox/OutboxEntry.ts'

describe('OutboxEntry', () => {
    test('shape carries id, controller, request, args, status', () => {
        const entry: OutboxEntry<{ text: string }> = {
            id: 'x',
            controller: new AbortController(),
            request: new Request('http://localhost/rpc/x', { method: 'POST' }),
            args: { text: 'hi' },
            status: 'queued',
        }
        expect(entry.status).toBe('queued')
        expect(entry.controller.signal.aborted).toBe(false)
    })
})
