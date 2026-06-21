import { constants, createGzip } from 'node:zlib'

/*
A gzip TransformStream that emits a decodable block after every input chunk via
Z_SYNC_FLUSH, instead of buffering until its deflate window fills like the web
CompressionStream. Used for the streamed SSR document so the head reaches the
browser compressed-but-decodable immediately — the preload scanner sees the
entry/css links and the pending shell paints — rather than only at stream close.
node:zlib is required here: the web CompressionStream exposes no per-chunk flush.
*/
export function flushingGzipStream(): TransformStream<Uint8Array, Uint8Array> {
    const gzip = createGzip()
    let sink: TransformStreamDefaultController<Uint8Array>
    /* `closed` gates enqueue: once the consumer cancels (client disconnect), the node
       gzip can still emit a trailing `data` that would throw on the closed controller. */
    let closed = false
    gzip.on('data', (chunk: Buffer) => {
        if (closed) {
            return
        }
        /* enqueue can still race a just-closed controller (cancel is async); treat the
           throw as the consumer having gone and tear down. */
        try {
            sink.enqueue(new Uint8Array(chunk))
        } catch {
            closed = true
            gzip.destroy()
        }
    })
    /* The spec'd Transformer.cancel hook (consumer-cancellation) postdates this TS lib's
       Transformer type; declare it locally so the literal type-checks while the platform
       (Bun) still invokes it. Typing the const sidesteps the fresh-literal excess-property
       check without weakening start/transform/flush. */
    const transformer: Transformer<Uint8Array, Uint8Array> & {
        cancel(reason?: unknown): void
    } = {
        start(controller) {
            sink = controller
            gzip.on('error', (error) => controller.error(error))
        },
        /* Resolve only once the chunk is compressed AND sync-flushed, so its bytes are
           on the wire before the stream pulls the next (possibly delayed) chunk. */
        transform(chunk) {
            return new Promise((resolve) => {
                gzip.write(chunk, () => gzip.flush(constants.Z_SYNC_FLUSH, () => resolve()))
            })
        },
        /* End the deflate stream; its trailing bytes arrive as `data` before `end`. */
        flush() {
            return new Promise((resolve) => {
                gzip.on('end', () => resolve())
                gzip.end()
            })
        },
        /* Consumer went away — stop enqueueing and tear down the node stream. */
        cancel() {
            closed = true
            gzip.destroy()
        },
    }
    return new TransformStream(transformer)
}
