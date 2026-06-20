import { isStreamingResponse } from '../../shared/isStreamingResponse.ts'
import { acceptsGzip } from './acceptsGzip.ts'
import { flushingGzipStream } from './flushingGzipStream.ts'
import { STREAMED_HTML_HEADER } from './STREAMED_HTML_HEADER.ts'

/*
Compressible Content-Types — text and structured-text payloads. Binary or
already-compressed bodies (images, fonts, archives, zstd/gzip blobs) gain
nothing from a second pass and only burn CPU.
*/
const COMPRESSIBLE_TYPE =
    /^(?:text\/|application\/(?:json|javascript|xml|[\w.-]+\+(?:json|xml))|image\/svg)/

/*
Gzips a dynamic response (SSR HTML, rpc/json replies, the plain 404) when the
client accepts it. Static assets never reach here — they already carry a
precompressed Content-Encoding, which short-circuits the first guard. Skipped
for: already-encoded bodies, bodiless responses (204/304/HEAD), non-compressible
types (images, fonts, archives), and frame-delimited streams (SSE/jsonl, where
gzip buffering would stall per-frame flush). No byte-size floor: Bun doesn't
expose a string body's length before send, and measuring would mean buffering the
body — the framing overhead on the rare tiny body is negligible against
compressing every page and rpc payload.

Buffered bodies take the web CompressionStream (best ratio, one flush at close).
The streamed SSR document self-marks (STREAMED_HTML_HEADER) and takes a
per-chunk-flushing gzip instead: the plain CompressionStream buffers the head
until its deflate window fills, which defeats streaming (the browser can't
preload-scan the head or paint the pending shell until the stream nearly closes).
The marker is stripped so it never reaches the client.
*/
export function gzipResponse(req: Request, response: Response): Response {
    const streamedHtml = response.headers.has(STREAMED_HTML_HEADER)
    if (streamedHtml) {
        response.headers.delete(STREAMED_HTML_HEADER)
    }
    if (!response.body || response.headers.has('Content-Encoding')) {
        return response
    }
    if (!acceptsGzip(req) || isStreamingResponse(response)) {
        return response
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    if (!COMPRESSIBLE_TYPE.test(contentType)) {
        return response
    }
    const headers = new Headers(response.headers)
    headers.set('Content-Encoding', 'gzip')
    headers.append('Vary', 'Accept-Encoding')
    /* The stored length no longer matches the compressed body (and is unknown for a stream). */
    headers.delete('Content-Length')
    const compressor = streamedHtml ? flushingGzipStream() : new CompressionStream('gzip')
    return new Response(response.body.pipeThrough(compressor), {
        status: response.status,
        statusText: response.statusText,
        headers,
    })
}
