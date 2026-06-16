import { describe, expect, spyOn, test } from 'bun:test'
import { runWithRequestScope } from '../src/lib/server/runtime/runWithRequestScope.ts'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const HEADER = `00-${TRACE_ID}-00f067aa0ba902b7-01`

describe('request scope trace + Server-Timing', () => {
    test('continues an inbound traceparent and exposes it via Server-Timing', async () => {
        const req = new Request('https://test.local/orders', {
            headers: { traceparent: HEADER },
        })
        const response = await runWithRequestScope(req, { logRequests: false }, async (store) => {
            expect(store.trace.traceId).toBe(TRACE_ID)
            expect(store.trace.parentSpanId).toBe('00f067aa0ba902b7')
            return new Response('ok')
        })
        const serverTiming = response.headers.get('server-timing') ?? ''
        expect(serverTiming).toMatch(/total;dur=\d+(\.\d+)?/)
        // The traceparent entry is the one header page JS can read — RUM linking.
        expect(serverTiming).toContain(`traceparent;desc="00-${TRACE_ID}-`)
    })

    test('mints a sampled trace when no header arrives', async () => {
        const response = await runWithRequestScope(
            new Request('https://test.local/'),
            { logRequests: false },
            async (store) => {
                expect(store.trace.traceId).toMatch(/^[0-9a-f]{32}$/)
                expect(store.trace.parentSpanId).toBeUndefined()
                return new Response('ok')
            },
        )
        expect(response.headers.get('server-timing')).toContain('-01"')
    })

    test('buffered responses emit the closing record before returning', async () => {
        const lines: string[] = []
        const spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(String(args[0]))
        })
        try {
            await runWithRequestScope(
                new Request('https://test.local/done?x=1'),
                { logRequests: true },
                async () => new Response('ok'),
            )
        } finally {
            spy.mockRestore()
        }
        const closing = lines.find((line) => line.includes('/done?x=1'))
        expect(closing).toBeDefined()
        expect(closing).toContain('200')
    })

    test('streaming responses emit the closing record at stream settle, not header time', async () => {
        const lines: string[] = []
        const spy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(String(args[0]))
        })
        try {
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('{"frame":1}\n'))
                    controller.close()
                },
            })
            const response = await runWithRequestScope(
                new Request('https://test.local/stream'),
                { logRequests: true },
                async () =>
                    new Response(body, { headers: { 'content-type': 'application/jsonl' } }),
            )
            // Headers are out, but the closing record waits for the body to drain.
            expect(lines.find((line) => line.includes('/stream'))).toBeUndefined()
            await response.text()
            await Bun.sleep(0)
            const closing = lines.find((line) => line.includes('/stream'))
            expect(closing).toBeDefined()
            expect(closing).toContain('200')
        } finally {
            spy.mockRestore()
        }
    })
})
