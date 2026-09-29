// 38.30 — A DOCUMENT, COMPRESSED WHOLE. `render` sends nothing until the page is built (41.1), so the
// document is in hand before a byte goes out and one compression of it is the whole answer — with its
// length known, where a stream compressed as it arrived had to be flushed at every chunk.
import { brotliCompressSync, constants } from 'node:zlib' // bun has gzip and zstd of its own, and no brotli
import type { Encoding } from './negotiateEncoding.ts'

// QUALITY 5, NOT 11. This runs per request, and the top brotli level is priced for a build that
// runs once: on an 18 KB docs page 11 took 15,800 µs against 5's 150, for 15% fewer bytes. 5 is
// already under gzip's size at twice gzip's 70 µs.
const DOCUMENT_QUALITY = 5

export function compressDocument(
    document: Uint8Array<ArrayBuffer>,
    encoding: Encoding,
): Uint8Array<ArrayBuffer> {
    return encoding === 'br'
        ? (brotliCompressSync(document, {
              params: { [constants.BROTLI_PARAM_QUALITY]: DOCUMENT_QUALITY },
          }) as Uint8Array<ArrayBuffer>)
        : Bun.gzipSync(document)
}
