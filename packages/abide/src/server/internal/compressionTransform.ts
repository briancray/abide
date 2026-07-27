import { createBrotliCompress, createGzip, constants as zlibConstants } from 'node:zlib'

// A `TransformStream` that compresses a streamed response body WITHOUT destroying its streaming.
//
// This is the one place the obvious answer is wrong. `new CompressionStream('gzip')` — web-standard,
// already in Bun — buffers: feeding it a page shell plus three rows 10ms apart yields two reads, a
// 10-byte header and then everything else AT CLOSE. Piping the SSR document through it would hold the
// shell until the last `{#for await}` row resolved, converting progressive rendering back into a
// buffered render while producing byte-identical output, so nothing but a timing test would notice.
//
// `node:zlib` is used instead because it is the only compressor here that can be told to FLUSH: after
// each input chunk, `flush()` forces the encoder to emit a complete, decodable block, and the same
// shell-plus-rows input comes out as `10,44 | 22 | 13` — one readable group per chunk written. That
// necessity is also why `node:` appears in this file at all (and brotli has no Bun API regardless).
//
// Quality is deliberately LOW here, unlike the build-time path: these settings run per request, and
// brotli at maximum quality would cost more CPU than the bytes it saves. Brotli 5 / gzip 6 are the
// conventional dynamic settings.
const DYNAMIC_BROTLI_QUALITY = 5
const DYNAMIC_GZIP_LEVEL = 6

export function compressionTransform(
    encoding: 'br' | 'gzip',
): TransformStream<Uint8Array, Uint8Array> {
    const compressor =
        encoding === 'br'
            ? createBrotliCompress({
                  params: { [zlibConstants.BROTLI_PARAM_QUALITY]: DYNAMIC_BROTLI_QUALITY },
              })
            : createGzip({ level: DYNAMIC_GZIP_LEVEL })
    // Each codec spells "emit a decodable block and keep going" differently; the generic default is
    // `Z_FULL_FLUSH`, which needlessly resets the dictionary between chunks and costs ratio.
    const flushKind =
        encoding === 'br' ? zlibConstants.BROTLI_OPERATION_FLUSH : zlibConstants.Z_SYNC_FLUSH

    const ready: Uint8Array[] = []
    let failure: Error | undefined
    // Resolver for the in-flight terminal operation. `end()`'s own callback fires on 'finish' — the
    // WRITABLE side closing — which happens before the codec has emitted its last block, so using it
    // truncates every stream by one block and the output fails to decode (`Z_BUF_ERROR`). 'end' is the
    // readable side draining, which is the signal that actually means "all output has been produced".
    let settleEnd: ((error?: Error) => void) | undefined
    compressor.on('data', (chunk: Buffer) => {
        // Copy out of the Buffer: node's allocator hands back pooled slices, and this view outlives the
        // callback for as long as the consumer takes to read it.
        ready.push(new Uint8Array(chunk))
    })
    compressor.on('end', () => {
        settleEnd?.()
    })
    compressor.on('error', (error: Error) => {
        failure = error
        settleEnd?.(error)
    })

    function drain(controller: TransformStreamDefaultController<Uint8Array>): void {
        for (const chunk of ready) controller.enqueue(chunk)
        ready.length = 0
    }

    return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            return new Promise((resolve, reject) => {
                compressor.write(chunk)
                compressor.flush(flushKind, () => {
                    if (failure !== undefined) {
                        reject(failure)
                        return
                    }
                    drain(controller)
                    resolve()
                })
            })
        },
        flush(controller) {
            return new Promise((resolve, reject) => {
                settleEnd = (error) => {
                    settleEnd = undefined
                    if (error !== undefined || failure !== undefined) {
                        reject(error ?? failure)
                        return
                    }
                    drain(controller)
                    resolve()
                }
                compressor.end()
            })
        },
    })
}
