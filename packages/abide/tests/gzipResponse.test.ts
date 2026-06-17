import { expect, test } from 'bun:test'
import { gzipResponse } from '../src/lib/server/runtime/gzipResponse.ts'

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
