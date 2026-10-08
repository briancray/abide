// 38.30 — AN ANSWER, COMPRESSED WHOLE: a document, and a JSON value at least `COMPRESSION_FLOOR`
// bytes long. Both are in hand before a byte goes out — `render` sends nothing until the page is
// built (41.1), and a value is stringified once — so one compression is the whole answer, with its
// length known, where a stream compressed as it arrived had to be flushed at every chunk.
//
// WHAT EACH LANE SENDS BESIDE THE BYTES is here too, so the two cannot drift. A document names
// `accept-encoding` in `vary` through `DOCUMENT_HEADERS`, which its `HEAD` and error answers carry as
// well; a JSON answer names it here. Both say their length: `abide dev` relays a body chunk by chunk
// from its worker (38.36), and a relayed body with no declared length goes out chunked.
import { brotliCompressSync, constants } from 'node:zlib' // bun has gzip and zstd of its own, and no brotli
import {
    ENCODINGS,
    type Encoding,
    negotiateEncoding,
} from './negotiateEncoding.ts'

// QUALITY 5, NOT 11. This runs per request, and the top brotli level is priced for a build that
// runs once: on an 18 KB docs page 11 took 15,800 µs against 5's 150, for 15% fewer bytes. 5 is
// already under gzip's size at twice gzip's 70 µs.
const QUALITY = 5

// 38.69 — the bytes under which a JSON answer goes out as it is. Under it an answer saves tens of
// bytes that leave in the same packet anyway, for 3–8 µs of a ~57 µs request; at 8 KB the same CPU
// saves seven kilobytes.
const COMPRESSION_FLOOR = 1024

const ENCODER = new TextEncoder()

function compressed(
    bytes: Uint8Array<ArrayBuffer>,
    encoding: Encoding,
): Uint8Array<ArrayBuffer> {
    return encoding === 'br'
        ? (brotliCompressSync(bytes, {
              params: { [constants.BROTLI_PARAM_QUALITY]: QUALITY },
          }) as Uint8Array<ArrayBuffer>)
        : Bun.gzipSync(bytes)
}

/**
 * `answer` as the `Response` to `request`, in the encoding the request takes where it takes one.
 *
 * THE LANE IS THE BODY'S TYPE: a built document arrives as its bytes, and a JSON value as its text,
 * encoded once here and floored by its length.
 */
export function compressAnswer(
    answer: Uint8Array<ArrayBuffer> | string,
    request: Request,
    headers: Headers,
    status: number,
): Response {
    const json = typeof answer === 'string'
    const bytes = json ? ENCODER.encode(answer) : answer
    const encoding =
        json && bytes.byteLength < COMPRESSION_FLOOR
            ? undefined
            : negotiateEncoding(
                  request.headers.get('accept-encoding'),
                  ENCODINGS,
              )
    if (json) headers.append('vary', 'accept-encoding')
    const body = encoding === undefined ? bytes : compressed(bytes, encoding)
    if (encoding !== undefined) headers.set('content-encoding', encoding)
    headers.set('content-length', String(body.byteLength))
    return new Response(body, { status, headers })
}
