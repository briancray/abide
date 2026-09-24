// 38.30 — which encoding a request takes, off `accept-encoding`, and the stream that compresses a
// document once it has. Asserted here rather than only through a server: every case below is a
// header a browser or a proxy really sends, and a server arm can only send the one header
// `Bun.fetch` was given.

import { expect, test } from 'bun:test'
import { brotliDecompressSync } from 'node:zlib' // bun decompresses gzip and zstd of its own, and no brotli
import { compressStream } from '#server/compressStream.ts'
import { ENCODINGS, negotiateEncoding } from '#server/negotiateEncoding.ts'
import { prefers } from '#server/prefers.ts'

test('no header, or only identity, is the bytes as they are — 38.30', () => {
    expect(negotiateEncoding(null, ENCODINGS)).toBeUndefined()
    expect(negotiateEncoding('', ENCODINGS)).toBeUndefined()
    expect(negotiateEncoding('identity', ENCODINGS)).toBeUndefined()
})

test('brotli wins a tie, whatever order the header lists them in — 38.30', () => {
    expect(negotiateEncoding('gzip, deflate, br, zstd', ENCODINGS)).toBe('br')
    expect(negotiateEncoding('br, gzip', ENCODINGS)).toBe('br')
    // What a browser sends over plain http.
    expect(negotiateEncoding('gzip, deflate', ENCODINGS)).toBe('gzip')
})

test('a quality is a preference and q=0 is a refusal — 38.30', () => {
    expect(negotiateEncoding('br;q=0.5, gzip', ENCODINGS)).toBe('gzip')
    expect(negotiateEncoding('br;q=0, gzip', ENCODINGS)).toBe('gzip')
    // THE WILDCARD NAMES WHAT IS NOT LISTED, and a listed refusal still stands beside it.
    expect(negotiateEncoding('br;q=0, *', ENCODINGS)).toBe('gzip')
    expect(negotiateEncoding('*', ENCODINGS)).toBe('br')
    expect(negotiateEncoding('*;q=0', ENCODINGS)).toBeUndefined()
    // A QUALITY THAT DOES NOT PARSE refuses rather than reading as 1.
    expect(negotiateEncoding('br;q=high, gzip;q=0.1', ENCODINGS)).toBe('gzip')
    expect(negotiateEncoding(' GZIP ; q=1 ', ENCODINGS)).toBe('gzip')
})

test('only what is on offer is chosen — 38.30', () => {
    expect(negotiateEncoding('br, gzip', ['gzip'])).toBe('gzip')
    expect(negotiateEncoding('br', ['gzip'])).toBeUndefined()
    expect(negotiateEncoding('br, gzip', [])).toBeUndefined()
})

// `accept` IS THE SAME GRAMMAR, read by `prefers` for 16.40's html-or-json and 16.33's framing. THE
// REVERT: find each type by `indexOf`, as it was; `text/html;q=0` then reads as preferring html,
// and a type named second at a higher quality loses to the one written first.
test('an accept header prefers by quality, then by order, and q=0 refuses', () => {
    const asks = (accept: string): Request =>
        new Request('http://x/', { headers: { accept } })
    const html = (accept: string): boolean =>
        prefers(asks(accept), 'text/html', 'application/json')
    // What a browser sends on a navigation, and what `fetch` sends by default.
    expect(html('text/html,application/xhtml+xml,*/*;q=0.8')).toBe(true)
    expect(html('*/*')).toBe(false)
    expect(html('application/json')).toBe(false)
    expect(html('text/html, application/json')).toBe(true)
    expect(html('application/json, text/html')).toBe(false)
    expect(html('text/html;q=0, application/json')).toBe(false)
    expect(html('text/html;q=0')).toBe(false)
    expect(html('application/json;q=0.5, text/html')).toBe(true)
    expect(html('text/html;q=0.5, application/json')).toBe(false)
})

// A CHUNK THAT COMPRESSES TO NOTHING. Brotli flushes an empty chunk that follows a flush to zero
// bytes, and a `pull` that enqueues nothing is never followed by another — so the document stops
// there for good, with no error and no end.
// THE REVERT: make the loop in `compressStream`'s `pull` an `if` and this times out at the empty
// chunk.
test('a chunk that compresses to nothing does not stall the document — 38.30', async () => {
    async function* chunks(): AsyncGenerator<Uint8Array> {
        yield new TextEncoder().encode('<head>')
        yield new Uint8Array(0)
        yield new TextEncoder().encode('</head><body>ok</body>')
    }
    const reading = new Response(compressStream(chunks(), 'br')).arrayBuffer()
    const settled = await Promise.race([
        reading,
        Bun.sleep(1_000).then(() => 'stalled' as const),
    ])
    expect(settled).not.toBe('stalled')
    expect(
        new TextDecoder().decode(
            brotliDecompressSync(new Uint8Array(settled as ArrayBuffer)),
        ),
    ).toBe('<head></head><body>ok</body>')
})
