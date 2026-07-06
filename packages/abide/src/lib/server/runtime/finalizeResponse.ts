import { responseBodyKind } from '../../shared/responseBodyKind.ts'
import { gzipResponse } from './gzipResponse.ts'
import type { RequestStore } from './types/RequestStore.ts'

/*
The wire-handling step every dynamic route's response crosses after its
handler (and app.handle) returns. The body is classified once
(responseBodyKind) and that one decision is threaded into every consumer, in
order: the closing-record stream monitor (store.responseStreaming), the idle
timeout — a streaming body (SSE / JSONL, socket tail) is opted out so a quiet
stream isn't reaped mid-flight — and gzip, which compresses compressible
dynamic bodies (SSR HTML, rpc/json, 404) when the client accepts it and
passes streaming frame protocols and opaque bodies through untouched.
`exemptIdleTimeout` is the server capability (server.timeout(req, 0))
injected by createServer, so the sequencing is testable without a live
socket. Framework plumbing endpoints answered before the request scope
(inspector / dev-reload SSE) don't cross this seam — they opt out via
disableIdleTimeoutForStream directly.
*/
export function finalizeResponse(
    req: Request,
    response: Response,
    store: RequestStore,
    exemptIdleTimeout: () => void,
): Response {
    const kind = responseBodyKind(response)
    store.responseStreaming = kind === 'streaming'
    if (kind === 'streaming') {
        exemptIdleTimeout()
    }
    return gzipResponse(req, response, kind)
}
