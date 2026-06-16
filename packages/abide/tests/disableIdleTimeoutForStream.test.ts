import { describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { disableIdleTimeoutForStream } from '../src/lib/server/runtime/disableIdleTimeoutForStream.ts'

// Minimal Server stub recording timeout() calls, enough for the seam under test.
function fakeServer(): { server: Server<unknown>; calls: Array<[Request, number]> } {
    const calls: Array<[Request, number]> = []
    const server = {
        timeout: (req: Request, seconds: number) => {
            calls.push([req, seconds])
        },
    } as unknown as Server<unknown>
    return { server, calls }
}

describe('disableIdleTimeoutForStream', () => {
    test('clears the idle timeout for the streaming content types', () => {
        for (const contentType of [
            'text/event-stream; charset=utf-8',
            'application/jsonl',
            'application/x-ndjson',
        ]) {
            const { server, calls } = fakeServer()
            const req = new Request('https://test.local/feed')
            const response = new Response(new ReadableStream(), {
                headers: { 'Content-Type': contentType },
            })
            const result = disableIdleTimeoutForStream(server, req, response)
            // Same response flows through, and exactly this request is opted out (0 = no timeout).
            expect(result).toBe(response)
            expect(calls).toEqual([[req, 0]])
        }
    })

    test('leaves a buffered response on the global timeout', () => {
        const { server, calls } = fakeServer()
        const req = new Request('https://test.local/orders')
        // Response.json's body is also a ReadableStream — content type is what distinguishes it.
        const response = Response.json({ ok: true })
        const result = disableIdleTimeoutForStream(server, req, response)
        expect(result).toBe(response)
        expect(calls).toEqual([])
    })
})
