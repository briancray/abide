import { contentBodyKind } from './contentBodyKind.ts'
import { contentTypeOf } from './contentTypeOf.ts'

/*
Compressible Content-Types — text and structured-text payloads. Binary or
already-compressed bodies (images, fonts, archives, zstd/gzip blobs) gain
nothing from a second pass and only burn CPU.
*/
const COMPRESSIBLE_TYPE =
    /^(?:text\/|application\/(?:json|javascript|xml|[\w.-]+\+(?:json|xml))|image\/svg)/

/*
The post-handler body class that decides a dynamic response's wire handling:
`streaming` (SSE / JSONL — drained frame-by-frame, never gzip-buffered, opted
out of the idle timeout), `compressible` (text/structured-text — gzipped when
the client accepts it), or `opaque` (binary/already-encoded — passed through).

One header read + classify per response, threaded through the dispatch pipeline
so `gzipResponse` and the idle-timeout opt-out don't each re-derive it from the
Content-Type (the S2 finding: the same body was classified 3-4×). Mirrors the
shared `contentBodyKind` streaming bucket so the wire path and the decode path
can't disagree on what's a stream.
*/
export type ResponseBodyKind = 'streaming' | 'compressible' | 'opaque'

export function responseBodyKind(response: Response): ResponseBodyKind {
    const contentType = contentTypeOf(response.headers)
    if (contentBodyKind(contentType) === 'streaming') {
        return 'streaming'
    }
    if (COMPRESSIBLE_TYPE.test(contentType)) {
        return 'compressible'
    }
    return 'opaque'
}
