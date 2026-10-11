// 38.30 — which encoding a request takes, off `accept-encoding`, and the compression of a document
// once it has. Asserted here rather than only through a server: every case below is a
// header a browser or a proxy really sends, and a server arm can only send the one header
// `Bun.fetch` was given.

import { expect, test } from 'bun:test'
import {
    brotliCompressSync,
    brotliDecompressSync,
    constants,
    gzipSync,
} from 'node:zlib' // bun has no brotli, and the lane under test compresses gzip with zlib's
import { compressAnswer } from '#server/compressAnswer.ts'
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

// `accept` IS THE SAME GRAMMAR, read by `prefers` for 16.38's html-or-json and 16.32's framing. THE
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

// A DOCUMENT IS COMPRESSED WHOLE and reads back byte for byte, in each encoding a request can take,
// with the length of what was sent declared. THE REVERT: set `content-length` off the bytes before
// they are compressed; the brotli answer declares 2031 bytes and sends 40.
test('a document compresses in either encoding, says its length and reads back whole — 38.30', async () => {
    const document = new TextEncoder().encode(
        `<!doctype html><title>x</title>${'<p>row</p>'.repeat(200)}`,
    )
    const decoded = new TextDecoder()
    for (const [encoding, decode] of [
        ['br', brotliDecompressSync],
        ['gzip', Bun.gunzipSync],
    ] as const) {
        const answer = await compressAnswer(
            document,
            asking(encoding),
            new Headers(),
            200,
        )
        const bytes = new Uint8Array(await answer.arrayBuffer())
        expect(answer.headers.get('content-encoding')).toBe(encoding)
        expect(answer.headers.get('content-length')).toBe(
            String(bytes.byteLength),
        )
        expect(decoded.decode(decode(bytes))).toBe(decoded.decode(document))
    }
    const plain = await compressAnswer(
        document,
        asking(null),
        new Headers(),
        200,
    )
    expect(plain.headers.get('content-encoding')).toBeNull()
    expect(plain.headers.get('content-length')).toBe(
        String(document.byteLength),
    )
})

// 38.30, 38.69 — A JSON ANSWER NAMES `accept-encoding` IN `vary` WHETHER OR NOT IT IS COMPRESSED, and
// under the floor goes as it is whatever the request takes; a document's `vary` is its headers'.
// Either way it says its length, as a document does. THE REVERT: drop the floor; the small answer is
// sent as brotli. Drop the JSON lane's `content-length`; both answers declare none.
test('a JSON answer varies on accept-encoding, says its length and is compressed only from the floor up — 38.30, 38.69', async () => {
    const small = await compressAnswer(
        '{"id":1}',
        asking('br'),
        new Headers({ vary: 'origin' }),
        200,
    )
    expect(small.headers.get('content-encoding')).toBeNull()
    expect(small.headers.get('vary')).toBe('origin, accept-encoding')
    expect(small.headers.get('content-length')).toBe('8')
    expect(await small.text()).toBe('{"id":1}')
    const text = JSON.stringify(
        Array.from({ length: 200 }, (_, id) => ({ id })),
    )
    const large = await compressAnswer(text, asking('gzip'), new Headers(), 201)
    expect(large.status).toBe(201)
    expect(large.headers.get('content-encoding')).toBe('gzip')
    expect(large.headers.get('vary')).toBe('accept-encoding')
    const sent = new Uint8Array(await large.arrayBuffer())
    expect(large.headers.get('content-length')).toBe(String(sent.byteLength))
    expect(new TextDecoder().decode(Bun.gunzipSync(sent))).toBe(text)
    const page = await compressAnswer(
        new TextEncoder().encode(text),
        asking('gzip'),
        new Headers(),
        200,
    )
    expect(page.headers.get('vary')).toBeNull()
})

// 38.96 — FROM 64 KB AN ANSWER IS COMPRESSED OFF THE EVENT LOOP, to the bytes the loop would have
// made, and under it with no await at all. A turn of the loop queued before the answer runs before
// the answer lands only when the compression left the loop. THE REVERT: compress every answer on
// the loop; the 620 KB answer lands with the turn not yet run, in either encoding.
test('a large answer is compressed off the loop to the same bytes, and a small one with no await — 38.96', async () => {
    const text = JSON.stringify(
        Array.from({ length: 7000 }, (_, id) => ({ id, name: `row ${id}` })),
    ).repeat(3)
    expect(text.length).toBeGreaterThan(64 * 1024)
    for (const [encoding, decode] of [
        ['br', brotliDecompressSync],
        ['gzip', Bun.gunzipSync],
    ] as const) {
        let turned = false
        setImmediate(() => {
            turned = true
        })
        const answer = await compressAnswer(
            text,
            asking(encoding),
            new Headers(),
            200,
        )
        expect(turned).toBe(true)
        const sent = new Uint8Array(await answer.arrayBuffer())
        expect(answer.headers.get('content-encoding')).toBe(encoding)
        expect(answer.headers.get('content-length')).toBe(
            String(sent.byteLength),
        )
        expect(new TextDecoder().decode(decode(sent))).toBe(text)
        const bytes = new TextEncoder().encode(text)
        expect(sent).toEqual(
            new Uint8Array(
                encoding === 'br'
                    ? brotliCompressSync(bytes, {
                          params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
                      })
                    : gzipSync(bytes),
            ),
        )
    }
    const under = compressAnswer(
        text.slice(0, 64 * 1024 - 1),
        asking('br'),
        new Headers(),
        200,
    )
    expect(under instanceof Response).toBe(true)
})

/**
 * A request taking `encoding`, or none — its headers alone, since the DOM preload's `Request` drops
 * `accept-encoding` as a browser's does.
 */
function asking(encoding: string | null): Request {
    const headers = new Headers()
    if (encoding !== null) headers.set('accept-encoding', encoding)
    return { headers } as Request
}
