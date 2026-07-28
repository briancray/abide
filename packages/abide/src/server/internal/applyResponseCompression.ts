import { appendVary } from './applyResponseHeaders.ts'
import { compressionMode } from './compressionMode.ts'
import { compressionTransform } from './compressionTransform.ts'
import { negotiateEncoding } from './negotiateEncoding.ts'

// DYNAMIC response compression, at the router's single terminal choke point — the counterpart to the
// build-time precompression of `/__abide/chunk/`. Off unless `ABIDE_COMPRESS=all` (see compressionMode).
//
// Two paths, chosen by media type, because a response body is either a stream that must stay one or a
// payload whose size we want to see before deciding:
//
//   STREAM (`text/html`) — the SSR document. Piped through a flushing compressor so the shell still
//     reaches the browser before the last `{#for await}` row resolves. Its length is unknown while it is
//     being produced, so no size floor can apply — and a streamed document is never small anyway.
//   BUFFER (JSON and friends) — read whole, measured against MINIMUM_DYNAMIC_BYTES, compressed only if
//     the result is actually smaller. Buffering is safe here only because the type allowlist below is
//     conservative: an UNKNOWN content type is skipped rather than buffered, since it could be an
//     unbounded stream and reading it to completion would hang the response.
//
// Two exclusions are deliberate and measured, not oversights:
//   `text/event-stream` — an SSE event must leave immediately, so the compressor would have to flush per
//     event, and at that granularity compression INFLATES: an 11-byte event comes out 14 bytes. Paying
//     CPU to enlarge the payload and add latency is worse on both axes.
//   `application/jsonl` — same arithmetic for the same reason. A jsonl stream of large rows would win,
//     but that is a per-RPC judgement, not something to infer from the media type.
const MINIMUM_DYNAMIC_BYTES = 1024

// Stage 1 owns these bytes: they are precompressed at build time and negotiated in the chunk route
// itself. Re-compressing an identity-served one here would undo a deliberate decision (a dev build's
// skipped compression, or an asset whose compressed form lost to its identity bytes).
const CHUNK_PREFIX = '/__abide/chunk/'

export async function applyResponseCompression(
    response: Response,
    request: Request,
    pathname: string,
): Promise<Response> {
    if (compressionMode() !== 'all') return response
    if (pathname.startsWith(CHUNK_PREFIX)) return response
    // A response that already declares an encoding was compressed by whoever produced it.
    if (response.headers.has('content-encoding')) return response
    if (response.body === null) return response
    // 204/304 carry no body, and a HEAD's body is dropped downstream — compressing either would only
    // rewrite headers to describe bytes that are never sent.
    if (response.status === 204 || response.status === 304) return response
    const method = request.method.toUpperCase()
    if (method === 'HEAD') return response

    const contentType = response.headers.get('content-type') ?? ''
    const shape = compressionShape(contentType)
    if (shape === 'skip') return response

    const encoding = negotiateEncoding(request.headers.get('accept-encoding'), true, true)
    if (encoding === 'identity') return response

    return shape === 'stream'
        ? compressStream(response, encoding)
        : await compressBuffered(response, encoding)
}

// Which treatment a media type gets. An allowlist rather than "text/* plus JSON": the fallback for an
// unrecognised type has to be `skip`, and a negative list would silently buffer the next streaming
// content type someone introduces.
function compressionShape(contentType: string): 'stream' | 'buffer' | 'skip' {
    const semicolon = contentType.indexOf(';')
    const base = (semicolon === -1 ? contentType : contentType.slice(0, semicolon))
        .trim()
        .toLowerCase()
    if (base === 'text/html') return 'stream'
    if (base === 'text/event-stream' || base === 'application/jsonl') return 'skip'
    if (
        base === 'application/json' ||
        base === 'text/plain' ||
        base === 'text/css' ||
        base === 'text/javascript' ||
        base === 'application/javascript' ||
        base === 'text/xml' ||
        base === 'application/xml' ||
        base === 'image/svg+xml' ||
        base.endsWith('+json') ||
        base.endsWith('+xml')
    )
        return 'buffer'
    return 'skip'
}

function compressStream(response: Response, encoding: 'br' | 'gzip'): Response {
    const body = response.body
    if (body === null) return response
    const compressed = new Response(body.pipeThrough(compressionTransform(encoding)), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    })
    stampEncoding(compressed, encoding)
    return compressed
}

async function compressBuffered(response: Response, encoding: 'br' | 'gzip'): Promise<Response> {
    const identity = new Uint8Array(await response.arrayBuffer())
    // The body is consumed now, so every path below must rebuild the response rather than return the
    // original — a `return response` here would send an empty body.
    if (identity.byteLength < MINIMUM_DYNAMIC_BYTES) return rebuild(response, identity)

    const compressed =
        encoding === 'br'
            ? await compressWholeBrotli(identity)
            : Bun.gzipSync(identity, { level: 6 })
    // Compression is not guaranteed to win on arbitrary payloads; if it did not, send the original.
    if (compressed.byteLength >= identity.byteLength) return rebuild(response, identity)

    const out = rebuild(response, compressed)
    stampEncoding(out, encoding)
    return out
}

// Brotli has no synchronous Bun API, so a buffered brotli goes through the same flushing transform the
// streaming path uses — one chunk in, one flush, done. Gzip never reaches here: its caller takes
// `Bun.gzipSync` directly, which is why this takes no encoding.
async function compressWholeBrotli(
    identity: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
    const source = new Response(identity).body
    if (source === null) return identity
    const piped = source.pipeThrough(compressionTransform('br'))
    return new Uint8Array(await new Response(piped).arrayBuffer())
}

function rebuild(response: Response, body: Uint8Array<ArrayBuffer>): Response {
    const rebuilt = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    })
    // Any inherited length describes the pre-compression representation.
    rebuilt.headers.delete('content-length')
    return rebuilt
}

function stampEncoding(response: Response, encoding: 'br' | 'gzip'): void {
    response.headers.set('content-encoding', encoding)
    response.headers.delete('content-length')
    // Appended, not set: a soft-nav response already varies on `Abide-Nav`, and the identity-scoped
    // default adds `Cookie` right after this runs.
    appendVary(response.headers, 'Accept-Encoding')
}
