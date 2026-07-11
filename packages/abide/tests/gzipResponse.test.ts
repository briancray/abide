import { expect, test } from 'bun:test'
import { gzipResponse } from '../src/lib/server/runtime/gzipResponse.ts'
import { STREAMED_HTML_HEADER } from '../src/lib/server/runtime/STREAMED_HTML_HEADER.ts'

const acceptsGzip = new Request('http://x/', { headers: { 'accept-encoding': 'gzip, br' } })
const noEncoding = new Request('http://x/')
const LARGE_HTML = '<!DOCTYPE html><html>'.padEnd(4096, 'x')

function htmlResponse(body: string): Response {
    return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

test('gzips a large compressible body when the client accepts gzip', async () => {
    const out = gzipResponse(acceptsGzip, htmlResponse(LARGE_HTML))
    expect(out.headers.get('Content-Encoding')).toBe('gzip')
    expect(out.headers.get('Vary')).toContain('Accept-Encoding')
    expect(out.headers.has('Content-Length')).toBe(false)
    /* Round-trips: the wire body decompresses back to the original. */
    const wire = new Uint8Array(await out.arrayBuffer())
    expect(new TextDecoder().decode(Bun.gunzipSync(wire))).toBe(LARGE_HTML)
})

test('passes through when the client does not accept gzip', () => {
    const out = gzipResponse(noEncoding, htmlResponse(LARGE_HTML))
    expect(out.headers.has('Content-Encoding')).toBe(false)
})

test('skips non-compressible content types', () => {
    const png = new Response(new Uint8Array(4096), { headers: { 'Content-Type': 'image/png' } })
    expect(gzipResponse(acceptsGzip, png).headers.has('Content-Encoding')).toBe(false)
})

test('skips frame-delimited streams (SSE) to preserve per-frame flush', () => {
    const sse = new Response('data: hi\n\n'.padEnd(4096, ' '), {
        headers: { 'Content-Type': 'text/event-stream' },
    })
    expect(gzipResponse(acceptsGzip, sse).headers.has('Content-Encoding')).toBe(false)
})

test('leaves an already-encoded response untouched', () => {
    const pre = new Response('x'.repeat(4096), {
        headers: { 'Content-Type': 'text/css', 'Content-Encoding': 'gzip' },
    })
    const out = gzipResponse(acceptsGzip, pre)
    expect(out).toBe(pre)
})

test('passes through a bodiless response', () => {
    const empty = new Response(undefined, { status: 204 })
    expect(gzipResponse(acceptsGzip, empty).headers.has('Content-Encoding')).toBe(false)
})

test('marked streamed HTML still gzips, strips the marker, and round-trips', async () => {
    const marked = new Response(LARGE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', [STREAMED_HTML_HEADER]: '1' },
    })
    const out = gzipResponse(acceptsGzip, marked)
    expect(out.headers.get('Content-Encoding')).toBe('gzip')
    /* The internal marker must never reach the client. */
    expect(out.headers.has(STREAMED_HTML_HEADER)).toBe(false)
    const wire = new Uint8Array(await out.arrayBuffer())
    expect(new TextDecoder().decode(Bun.gunzipSync(wire))).toBe(LARGE_HTML)
})

/* The marker is stripped even on a skip path, so it can't leak when gzip is declined. */
test('strips the streamed-HTML marker when the client does not accept gzip', () => {
    const marked = new Response(LARGE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', [STREAMED_HTML_HEADER]: '1' },
    })
    const out = gzipResponse(noEncoding, marked)
    expect(out.headers.has('Content-Encoding')).toBe(false)
    expect(out.headers.has(STREAMED_HTML_HEADER)).toBe(false)
})

/*
The streamed document must be flushed per chunk, not buffered: feed a head chunk
through a marked streaming body and assert its bytes reach the wire before a later
(delayed) chunk — proof the head is decodable mid-stream for the preload scanner.
A buffering CompressionStream would hold the head until close, hanging this read.
*/
test('marked streamed HTML flushes the head before a delayed later chunk', async () => {
    const HEAD = `<link rel="modulepreload" href="/_app/client.js">${'x'.repeat(2048)}`
    let releaseTail: () => void = () => {}
    const body = new ReadableStream<Uint8Array>({
        async start(controller) {
            controller.enqueue(new TextEncoder().encode(HEAD))
            /* Hold the tail open: the head must be readable while this is pending. */
            await new Promise<void>((resolve) => {
                releaseTail = resolve
            })
            controller.enqueue(new TextEncoder().encode('<p>tail</p>'))
            controller.close()
        },
    })
    const out = gzipResponse(
        acceptsGzip,
        new Response(body, {
            headers: { 'Content-Type': 'text/html; charset=utf-8', [STREAMED_HTML_HEADER]: '1' },
        }),
    )
    const reader = out.body!.getReader()
    /* Resolves only if compressed head bytes arrive while the tail is still held —
       a buffering compressor would leave this read pending until close. */
    const { value } = await reader.read()
    expect(value?.byteLength).toBeGreaterThan(0)
    /* Cancel while the tail is still parked, then release so the body's start() unwinds. */
    await reader.cancel()
    releaseTail()
})
