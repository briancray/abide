// 38.30 — A DOCUMENT, COMPRESSED AS IT IS RENDERED, FLUSHED AT EVERY CHUNK. `render` sends the head
// on its own so the fetches it names start before the page is built (41.1), and a compressor that
// holds its input until it has a block's worth would put that head back behind the body — which
// is exactly what `CompressionStream` does: handed the head alone, it answers the ten bytes of a
// gzip header and nothing more until it is closed. A sync flush per chunk is what keeps 41.1.
//
// `node:zlib` stands in for the flushable streaming compressor bun does not have: `Bun.gzipSync`
// is one-shot and `CompressionStream` cannot flush.
import {
    type BrotliCompress,
    constants,
    createBrotliCompress,
    createGzip,
    type Gzip,
} from 'node:zlib'
import type { Encoding } from './negotiateEncoding.ts'

// QUALITY 5, NOT 11. This runs per request, and the top brotli level is priced for a build that
// runs once: on an 18 KB docs page 11 took 15,800 µs against 5's 150, for 15% fewer bytes. 5 is
// already under gzip's size at twice gzip's 70 µs.
const DOCUMENT_QUALITY = 5

export function compressStream(
    chunks: AsyncGenerator<Uint8Array>,
    encoding: Encoding,
): ReadableStream<Uint8Array> {
    const compressor: Gzip | BrotliCompress =
        encoding === 'br'
            ? createBrotliCompress({
                  params: {
                      [constants.BROTLI_PARAM_QUALITY]: DOCUMENT_QUALITY,
                  },
              })
            : createGzip()
    let ended = false
    // Bytes the compressor has handed over, counted so `pull` can tell whether it produced any.
    let produced = 0
    return new ReadableStream<Uint8Array>({
        start(controller) {
            compressor.on('data', (bytes: Uint8Array) => {
                produced += 1
                controller.enqueue(bytes)
            })
            compressor.on('end', () => controller.close())
            compressor.on('error', (thrown) => controller.error(thrown))
        },
        // A PULL THAT ENQUEUES NOTHING IS NEVER FOLLOWED BY ANOTHER: the stream asks again only
        // once something arrives. So a chunk that compresses to nothing at its flush would stall
        // the response for good — this reads on until the compressor hands something over, or the
        // render is done and `end` is what closes the stream.
        async pull() {
            const before = produced
            while (!ended && produced === before) {
                // 41.16 — A THROW FROM THE RENDER ERRORS THIS STREAM, by propagating out of
                // `pull`, so a document that failed after its head still ends short.
                let next: IteratorResult<Uint8Array>
                try {
                    next = await chunks.next()
                } catch (thrown) {
                    compressor.destroy()
                    throw thrown
                }
                if (next.done === true) {
                    ended = true
                    compressor.end()
                    return
                }
                compressor.write(next.value)
                await new Promise<void>((flushed) => compressor.flush(flushed))
            }
        },
        cancel() {
            compressor.destroy()
            void chunks.return(undefined)
        },
    })
}
