import type { ResponseBodyKind } from '../../shared/responseBodyKind.ts'
import { responseBodyKind } from '../../shared/responseBodyKind.ts'
import { acceptsGzip } from './acceptsGzip.ts'
import { flushingGzipStream } from './flushingGzipStream.ts'
import { STREAMED_HTML_HEADER } from './STREAMED_HTML_HEADER.ts'

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

`kind` is the body class the dispatch pipeline already computed (S2: classify
once, thread it in) — only `compressible` bodies gzip; `streaming` and `opaque`
pass through. Standalone callers (the health probe) omit it and it's derived
here. The streamed-HTML marker is handled independent of `kind` since it's
stripped even on a skip path.

Buffered bodies take the web CompressionStream (best ratio, one flush at close).
The streamed SSR document self-marks (STREAMED_HTML_HEADER) and takes a
per-chunk-flushing gzip instead: the plain CompressionStream buffers the head
until its deflate window fills, which defeats streaming (the browser can't
preload-scan the head or paint the pending shell until the stream nearly closes).
The marker is stripped so it never reaches the client.
*/
export function gzipResponse(req: Request, response: Response, kind?: ResponseBodyKind): Response {
    const streamedHtml = response.headers.has(STREAMED_HTML_HEADER)
    if (streamedHtml) {
        response.headers.delete(STREAMED_HTML_HEADER)
    }
    if (!response.body || response.headers.has('Content-Encoding')) {
        return response
    }
    /* A streamed-HTML document classifies as `compressible` (text/html) but the
       marker was already stripped above, so re-derive after the strip when the
       pipeline didn't hand a kind in. */
    const bodyKind = kind ?? responseBodyKind(response)
    if (!acceptsGzip(req) || bodyKind !== 'compressible') {
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
