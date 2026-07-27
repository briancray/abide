// DYNAMIC response compression (`ABIDE_COMPRESS=all`) — streamed HTML documents and buffered JSON.
//
// The load-bearing test in this file is the PROGRESSIVE one. Swapping the flushing `node:zlib`
// transform for the web-standard `new CompressionStream('gzip')` produces byte-identical output and
// passes every other assertion here, while silently converting streaming SSR into a buffered render —
// the shell would not leave the server until the last `{#for await}` row resolved. Only an assertion
// about WHEN bytes arrive can catch that, so `emits output per input chunk` is the regression guard.

import { expect, test } from 'bun:test'
import { brotliDecompressSync, createBrotliDecompress, createGunzip } from 'node:zlib'
import { GET } from '../server/GET.ts'
import { createTestApp } from '../test/createTestApp.ts'
import { applyResponseCompression } from './internal/applyResponseCompression.ts'
import { compressionTransform } from './internal/compressionTransform.ts'

// `ABIDE_COMPRESS` is read per call, so a test can flip it — but it is process-wide, so every test that
// does must put it back or it leaks into the rest of the suite.
async function withCompressAll<T>(run: () => Promise<T>): Promise<T> {
    const previous = Bun.env.ABIDE_COMPRESS
    Bun.env.ABIDE_COMPRESS = 'all'
    try {
        return await run()
    } finally {
        if (previous === undefined) delete Bun.env.ABIDE_COMPRESS
        else Bun.env.ABIDE_COMPRESS = previous
    }
}

function get(headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/x', { headers })
}

function join(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
    let at = 0
    for (const chunk of chunks) {
        out.set(chunk, at)
        at += chunk.byteLength
    }
    return out
}

// Decode a PARTIAL compressed stream — everything emitted so far, with the producer still open. A
// flushed encoder yields complete blocks, so the text up to the last flush comes back out; an encoder
// that has only written a header yields nothing, which is exactly the distinction under test.
function decodePrefix(bytes: Uint8Array, encoding: 'br' | 'gzip'): Promise<string> {
    return new Promise((resolve) => {
        const decoder = encoding === 'br' ? createBrotliDecompress() : createGunzip()
        let out = ''
        decoder.on('data', (chunk: Buffer) => {
            out += chunk.toString()
        })
        // A truncated prefix is not an error condition here — it just means nothing decodable arrived.
        decoder.on('error', () => resolve(out))
        decoder.write(bytes)
        decoder.flush(() => resolve(out))
    })
}

const ACCEPTS = { 'accept-encoding': 'br, gzip' }

test('compressionTransform emits output per input chunk, before the stream closes', async () => {
    for (const encoding of ['br', 'gzip'] as const) {
        const encoder = new TextEncoder()
        const SHELL = `<!doctype html><head>${'x'.repeat(2000)}</head><body>`
        const ROW = '<li>row one</li>'

        // The source emits the shell and then BLOCKS on a gate, exactly like an SSR document waiting on
        // a slow `{#for await}`. While it is gated the stream cannot possibly have closed, so a read
        // that resolves here proves output was produced mid-stream rather than buffered to the end.
        let openTheGate: () => void = () => {}
        const gate = new Promise<void>((resolve) => {
            openTheGate = resolve
        })
        const source = new ReadableStream<Uint8Array>({
            async start(controller) {
                controller.enqueue(encoder.encode(SHELL))
                await gate
                controller.enqueue(encoder.encode(ROW))
                controller.close()
            },
        })

        const reader = source.pipeThrough(compressionTransform(encoding)).getReader()

        // Collect chunks until the shell's CONTENT decodes — the source is still gated throughout, so
        // ANY success here proves output was produced mid-stream. The stop condition is the assertion
        // itself, never a quiescence window: a fixed "nothing for 50ms → done" bound is a wall-clock
        // race, and on a loaded box (a parallel test run) the flush lands after it and the test reads
        // as "the compressor withheld the shell". Failure is a timeout, so a real withholding still
        // fails — it just can't be faked by scheduling.
        const preGate: Uint8Array[] = []
        let decoded = ''
        const deadline = Date.now() + 10_000
        while (!decoded.includes('<body>')) {
            const result = await Promise.race([
                reader.read(),
                new Promise<'timeout'>((resolve) =>
                    setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now())),
                ),
            ])
            if (result === 'timeout')
                throw new Error(
                    `compressionTransform(${encoding}) withheld the shell while the source was still open`,
                )
            if (result.done) break
            if (result.value !== undefined) preGate.push(result.value)
            decoded = await decodePrefix(join(preGate), encoding)
        }

        // THE ASSERTION THAT MATTERS. Not "some bytes arrived" — `CompressionStream` emits its 10-byte
        // gzip header immediately and would satisfy that while withholding all content until close. The
        // shell's CONTENT has to be decodable by a client right now, with the stream still open.
        expect(decoded).toContain('<body>')

        openTheGate()
        const tail: Uint8Array[] = []
        for (;;) {
            const next = await reader.read()
            if (next.done) break
            if (next.value !== undefined) tail.push(next.value)
        }

        const joined = join([...preGate, ...tail])
        // Flushing per chunk must not corrupt the stream: it still decodes to exactly what went in.
        const whole = encoding === 'br' ? brotliDecompressSync(joined) : Bun.gunzipSync(joined)
        expect(new TextDecoder().decode(whole)).toBe(SHELL + ROW)
    }
})

test('a streamed HTML document is compressed and stays a stream', async () => {
    await withCompressAll(async () => {
        const html = `<!doctype html><html><body>${'<p>hello world</p>'.repeat(200)}</body></html>`
        const source = new Response(html, {
            headers: { 'content-type': 'text/html; charset=utf-8' },
        })
        const out = await applyResponseCompression(source, get(ACCEPTS), '/')

        expect(out.headers.get('content-encoding')).toBe('br')
        expect(out.headers.get('vary')).toContain('Accept-Encoding')
        // A length inherited from the identity representation would describe the wrong bytes.
        expect(out.headers.get('content-length')).toBeNull()

        const bytes = new Uint8Array(await out.arrayBuffer())
        expect(bytes.byteLength).toBeLessThan(html.length / 2)
        expect(new TextDecoder().decode(brotliDecompressSync(bytes))).toBe(html)
    })
})

test('a page served over HTTP arrives compressed and hydratable', async () => {
    await withCompressAll(async () => {
        const app = await createTestApp({
            pages: { '/': `<h1>hi</h1><p>${'compress me. '.repeat(200)}</p>` },
        })
        try {
            const response = await app.fetch('/', { headers: ACCEPTS })
            expect(response.status).toBe(200)
            expect(response.headers.get('content-encoding')).toBe('br')
            expect(response.headers.get('vary')).toContain('Accept-Encoding')
            // The identity-scoped cache default still applies — compression does not displace it.
            expect(response.headers.get('vary')).toContain('Cookie')
            // Bun's fetch decodes it; the document must be intact, script tag and all.
            const body = await response.text()
            expect(body).toContain('<h1>hi</h1>')
            expect(body).toContain('/__abide/chunk/')
        } finally {
            await app.stop()
        }
    })
})

test('SSE and jsonl are never compressed — per-event flushing inflates them', async () => {
    await withCompressAll(async () => {
        const payload = 'data: {"n":1}\n\n'.repeat(200)
        for (const type of ['text/event-stream', 'application/jsonl']) {
            const out = await applyResponseCompression(
                new Response(payload, { headers: { 'content-type': type } }),
                get(ACCEPTS),
                '/x',
            )
            expect(out.headers.get('content-encoding')).toBeNull()
            expect(await out.text()).toBe(payload)
        }
    })
})

test('buffered JSON compresses above the floor and passes through below it', async () => {
    await withCompressAll(async () => {
        const big = JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ i, s: 'x' })) })
        expect(big.length).toBeGreaterThan(1024)
        const compressed = await applyResponseCompression(
            new Response(big, { headers: { 'content-type': 'application/json' } }),
            get(ACCEPTS),
            '/__abide/rpc/rows',
        )
        expect(compressed.headers.get('content-encoding')).toBe('br')
        // `.text()` on a locally built Response does NOT decode content-encoding (only `fetch` does),
        // so the round-trip is explicit here.
        const bytes = new Uint8Array(await compressed.arrayBuffer())
        expect(bytes.byteLength).toBeLessThan(big.length)
        expect(new TextDecoder().decode(brotliDecompressSync(bytes))).toBe(big)

        // Under one KB there is no round trip to save, so it is left alone — and crucially the body
        // SURVIVES: the buffered path consumed the original stream and must rebuild the response.
        const small = JSON.stringify({ ok: true })
        const untouched = await applyResponseCompression(
            new Response(small, { headers: { 'content-type': 'application/json' } }),
            get(ACCEPTS),
            '/__abide/rpc/ok',
        )
        expect(untouched.headers.get('content-encoding')).toBeNull()
        expect(await untouched.text()).toBe(small)
    })
})

test('an RPC read over HTTP compresses its JSON payload', async () => {
    await withCompressAll(async () => {
        const app = await createTestApp({
            routes: {
                rows: GET(() => ({ rows: Array.from({ length: 300 }, (_, i) => ({ i, s: 'x' })) })),
            },
        })
        try {
            const response = await app.fetch('/__abide/rpc/rows', { headers: ACCEPTS })
            expect(response.status).toBe(200)
            expect(response.headers.get('content-encoding')).toBe('br')
            const payload = (await response.json()) as { rows: unknown[] }
            expect(payload.rows.length).toBe(300)
        } finally {
            await app.stop()
        }
    })
})

test('the exclusions hold: unknown types, pre-encoded, bodyless, HEAD, and chunk assets', async () => {
    await withCompressAll(async () => {
        const body = 'z'.repeat(4000)

        // An unrecognised media type is SKIPPED, not buffered — it could be an unbounded stream.
        const unknown = await applyResponseCompression(
            new Response(body, { headers: { 'content-type': 'application/x-custom' } }),
            get(ACCEPTS),
            '/x',
        )
        expect(unknown.headers.get('content-encoding')).toBeNull()

        // Something upstream already encoded this.
        const preEncoded = await applyResponseCompression(
            new Response(body, {
                headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
            }),
            get(ACCEPTS),
            '/x',
        )
        expect(preEncoded.headers.get('content-encoding')).toBe('gzip')

        // 204 has no body to compress.
        const empty = await applyResponseCompression(
            new Response(null, { status: 204 }),
            get(ACCEPTS),
            '/x',
        )
        expect(empty.headers.get('content-encoding')).toBeNull()

        // A HEAD's body is dropped downstream, so encoding headers would describe bytes never sent.
        const head = await applyResponseCompression(
            new Response(body, { headers: { 'content-type': 'application/json' } }),
            new Request('http://localhost/x', { method: 'HEAD', headers: ACCEPTS }),
            '/x',
        )
        expect(head.headers.get('content-encoding')).toBeNull()

        // Stage 1 owns the content-addressed assets; dynamic compression must not second-guess it.
        const chunk = await applyResponseCompression(
            new Response(body, { headers: { 'content-type': 'text/javascript' } }),
            get(ACCEPTS),
            '/__abide/chunk/loader-abc.js',
        )
        expect(chunk.headers.get('content-encoding')).toBeNull()

        // A client that wants nothing gets identity.
        const refused = await applyResponseCompression(
            new Response(body, { headers: { 'content-type': 'application/json' } }),
            get({ 'accept-encoding': 'identity' }),
            '/x',
        )
        expect(refused.headers.get('content-encoding')).toBeNull()
    })
})

test('dynamic compression is OFF unless asked for', async () => {
    const body = `<!doctype html><html><body>${'<p>x</p>'.repeat(500)}</body></html>`
    // Default (`static`) — the chunk assets are precompressed, but a page is not.
    const byDefault = await applyResponseCompression(
        new Response(body, { headers: { 'content-type': 'text/html' } }),
        get(ACCEPTS),
        '/',
    )
    expect(byDefault.headers.get('content-encoding')).toBeNull()

    const previous = Bun.env.ABIDE_COMPRESS
    Bun.env.ABIDE_COMPRESS = 'off'
    try {
        const off = await applyResponseCompression(
            new Response(body, { headers: { 'content-type': 'text/html' } }),
            get(ACCEPTS),
            '/',
        )
        expect(off.headers.get('content-encoding')).toBeNull()
    } finally {
        if (previous === undefined) delete Bun.env.ABIDE_COMPRESS
        else Bun.env.ABIDE_COMPRESS = previous
    }
})

test('Vary is appended, never clobbered — a soft-nav response varies on both', async () => {
    await withCompressAll(async () => {
        const payload = JSON.stringify({ redirect: '', seed: {}, pad: 'x'.repeat(2000) })
        const out = await applyResponseCompression(
            new Response(payload, {
                headers: { 'content-type': 'application/json', vary: 'Abide-Nav' },
            }),
            get(ACCEPTS),
            '/',
        )
        const vary = out.headers.get('vary') ?? ''
        expect(vary).toContain('Abide-Nav')
        expect(vary).toContain('Accept-Encoding')
    })
})
