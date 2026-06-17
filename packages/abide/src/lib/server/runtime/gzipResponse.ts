import { isStreamingResponse } from '../../shared/isStreamingResponse.ts'
import { acceptsGzip } from './acceptsGzip.ts'

/*
Compressible Content-Types — text and structured-text payloads. Binary or
already-compressed bodies (images, fonts, archives, zstd/gzip blobs) gain
nothing from a second pass and only burn CPU.
*/
const COMPRESSIBLE_TYPE =
    /^(?:text\/|application\/(?:json|javascript|xml|[\w.-]+\+(?:json|xml))|image\/svg)/

/*
Gzips a dynamic response (SSR HTML, rpc/json replies, the plain 404) when the
client accepts it, piping the body through a CompressionStream so a buffered
body and a streamed SSR document take the identical path. Static assets never
reach here — they already carry a precompressed Content-Encoding, which
short-circuits the first guard. Skipped for: already-encoded bodies, bodiless
responses (204/304/HEAD), non-compressible types (images, fonts, archives),
and frame-delimited streams (SSE/jsonl, where gzip buffering would stall
per-frame flush). No byte-size floor: Bun doesn't expose a string body's length
before send, and measuring would mean buffering the streamed SSR document —
the framing overhead on the rare tiny body is negligible against compressing
every page and rpc payload.
*/
export function gzipResponse(req: Request, response: Response): Response {
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
    return new Response(response.body.pipeThrough(new CompressionStream('gzip')), {
        status: response.status,
        statusText: response.statusText,
        headers,
    })
}
