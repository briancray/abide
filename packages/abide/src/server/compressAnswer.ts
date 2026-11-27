// 38.29 — AN ANSWER, COMPRESSED WHOLE: a document, and a JSON value at least `COMPRESSION_FLOOR`
// bytes long. Both are in hand before a byte goes out — `render` sends nothing until the page is
// built (41.1), and a value is stringified once — so one compression is the whole answer, with its
// length known, where a stream compressed as it arrived had to be flushed at every chunk.
//
// WHAT EACH LANE SENDS BESIDE THE BYTES. The JSON lane names `accept-encoding` in `vary` here; the
// bytes lane leaves it to the CALLER's headers — `DOCUMENT_HEADERS` for a page or an error page,
// which its `HEAD` carries as well, and `answerValue`'s own append for a document `response.page()` hands
// back. Both say their length: `abide dev` relays a body chunk by chunk
// from its worker (38.35), and a relayed body with no declared length goes out chunked.
// BUN'S GZIP parts from zlib's past ~130 KB, which only the off-loop lane reaches — so that lane takes
// zlib's, the loop keeps bun's, and the two make the same bytes.
import {
    brotliCompress,
    brotliCompressSync,
    type BrotliOptions,
    constants,
    gzip,
} from 'node:zlib' // bun's own brotli is `CompressionStream`, on the main thread — 1390 ms against zlib's pool's 300 ms over the docs bundle — and bun compresses nothing off the loop

import {
    type Encoding,
    ENCODINGS,
    negotiateEncoding,
} from './negotiateEncoding.ts'

// QUALITY 5, NOT 11. This runs per request, and the top brotli level is priced for a build that
// runs once: on an 18 KB docs page 11 took 15,800 µs against 5's 150, for 15% fewer bytes. 5 is
// already under gzip's size at twice gzip's 70 µs.
const REQUEST_QUALITY = 5

// 38.68 — the bytes under which a JSON answer goes out as it is. Under it an answer saves tens of
// bytes that leave in the same packet anyway, for 3–8 µs of a ~57 µs request; at 8 KB the same CPU
// saves seven kilobytes.
const COMPRESSION_FLOOR = 1024

// 38.95 — the bytes from which an answer is compressed off the event loop. Brotli 5 holds the loop
// ~360 µs at 64 KB and ~7 ms at 700 KB — every other request and socket waits that long — where
// the thread pool's hop adds ~20 µs to the answer it carries: 6% at 64 KB, 27% at 16 KB.
const OFF_LOOP_FLOOR = 64 * 1024

const ENCODER = new TextEncoder()

function compressed(
    bytes: Uint8Array<ArrayBuffer>,
    encoding: Encoding,
): Uint8Array<ArrayBuffer> {
    return encoding === 'br'
        ? (brotliCompressSync(
              bytes,
              brotliOptions(bytes, REQUEST_QUALITY),
          ) as Uint8Array<ArrayBuffer>)
        : Bun.gzipSync(bytes)
}

function compressedOffLoop(
    bytes: Uint8Array<ArrayBuffer>,
    encoding: Encoding,
): Promise<Uint8Array<ArrayBuffer>> {
    if (encoding === 'br') return brotliOffLoop(bytes, REQUEST_QUALITY)
    return new Promise((resolve, reject) => {
        gzip(bytes, (error, result) => {
            if (error === null) resolve(result as Uint8Array<ArrayBuffer>)
            else reject(error)
        })
    })
}

/** The brotli that compresses `bytes` at `quality`, told their size. */
function brotliOptions(
    bytes: Uint8Array<ArrayBuffer>,
    quality: number,
): BrotliOptions {
    return {
        params: {
            [constants.BROTLI_PARAM_QUALITY]: quality,
            [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
        },
    }
}

/**
 * `bytes` brotli-compressed off the main thread at `quality`: a request's answer at 5, a build's
 * files at `BROTLI_MAX_QUALITY`.
 */
export function brotliOffLoop(
    bytes: Uint8Array<ArrayBuffer>,
    quality: number,
): Promise<Uint8Array<ArrayBuffer>> {
    return new Promise((resolve, reject) => {
        brotliCompress(
            bytes,
            brotliOptions(bytes, quality),
            (error, result) => {
                if (error === null) resolve(result as Uint8Array<ArrayBuffer>)
                else reject(error)
            },
        )
    })
}

/** Brotli's top quality, what a build's files are compressed at once. */
export const BROTLI_MAX_QUALITY: number = constants.BROTLI_MAX_QUALITY

function answered(
    body: Uint8Array<ArrayBuffer>,
    encoding: Encoding | undefined,
    headers: Headers,
    status: number,
): Response {
    if (encoding !== undefined) headers.set('content-encoding', encoding)
    headers.set('content-length', String(body.byteLength))
    return new Response(body, { status, headers })
}

/**
 * `answer` as the `Response` to `request`, in the encoding the request takes where it takes one.
 *
 * THE LANE IS THE BODY'S TYPE: a built document arrives as its bytes, and a JSON value as its text,
 * encoded once here and floored by its length. A `Promise` only where the compression runs off the
 * loop, so an answer under that floor costs no await.
 */
export function compressAnswer(
    answer: Uint8Array<ArrayBuffer> | string,
    request: Request,
    headers: Headers,
    status: number,
): Response | Promise<Response> {
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
    if (encoding === undefined)
        return answered(bytes, encoding, headers, status)
    if (bytes.byteLength >= OFF_LOOP_FLOOR)
        return compressedOffLoop(bytes, encoding).then((body) =>
            answered(body, encoding, headers, status),
        )
    return answered(compressed(bytes, encoding), encoding, headers, status)
}
