// 38.29 — AN ANSWER, COMPRESSED WHOLE: a document, and a JSON value at least `COMPRESSION_FLOOR`
// bytes long. Both are in hand before a byte goes out — `render` sends nothing until the page is
// built (41.1), and a value is stringified once — so one compression is the whole answer, with its
// length known, where a stream compressed as it arrived had to be flushed at every chunk.
//
// WHAT EACH LANE SENDS BESIDE THE BYTES is here too, so the two cannot drift. A document names
// `accept-encoding` in `vary` through `DOCUMENT_HEADERS`, which its `HEAD` and error answers carry as
// well; a JSON answer names it here. Both say their length: `abide dev` relays a body chunk by chunk
// from its worker (38.35), and a relayed body with no declared length goes out chunked.
// BUN'S GZIP parts from zlib's past ~130 KB, which only the off-loop lane reaches — so that lane takes
// zlib's, the loop keeps bun's, and the two make the same bytes.
import { brotliCompress, brotliCompressSync, constants, gzip } from 'node:zlib' // bun has no brotli, and no compression off the loop

import {
    type Encoding,
    ENCODINGS,
    negotiateEncoding,
} from './negotiateEncoding.ts'

// QUALITY 5, NOT 11. This runs per request, and the top brotli level is priced for a build that
// runs once: on an 18 KB docs page 11 took 15,800 µs against 5's 150, for 15% fewer bytes. 5 is
// already under gzip's size at twice gzip's 70 µs.
const BROTLI_OPTIONS = { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }

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
        ? (brotliCompressSync(bytes, BROTLI_OPTIONS) as Uint8Array<ArrayBuffer>)
        : Bun.gzipSync(bytes)
}

function compressedOffLoop(
    bytes: Uint8Array<ArrayBuffer>,
    encoding: Encoding,
): Promise<Uint8Array<ArrayBuffer>> {
    return new Promise((resolve, reject) => {
        const settle = (error: Error | null, result: Uint8Array): void => {
            if (error === null) resolve(result as Uint8Array<ArrayBuffer>)
            else reject(error)
        }
        if (encoding === 'br') brotliCompress(bytes, BROTLI_OPTIONS, settle)
        else gzip(bytes, settle)
    })
}

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
