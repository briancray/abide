import type { Server } from 'bun'
import { isStreamingResponse } from '../../shared/isStreamingResponse.ts'

/*
Opts a long-lived streaming response (SSE / JSONL) out of Bun's per-connection
idle timeout. Such a stream can stay quiet for longer than the 10s default
between frames, which Bun would otherwise read as an idle connection and close
mid-stream. `server.timeout(req, 0)` clears the timeout for just this in-flight
request, leaving the global default in place for ordinary traffic. Streaming is
detected by Content-Type (the shared signal the CLI/MCP drain paths use) rather
than `body instanceof ReadableStream`, since every bodied Response exposes one.

A streamed SSR page (`text/html`) is deliberately not opted out: it inherits the
configured `idleTimeout` as a bounded cap on how long it can hold the connection,
and the client re-fetches any placeholder left unresolved by a cut stream (see
streamCacheResolutions, which yields { key, miss } markers the client re-fetches). Non-stream responses pass through.
*/
export function disableIdleTimeoutForStream(
    server: Server<unknown>,
    req: Request,
    response: Response,
): Response {
    if (isStreamingResponse(response)) {
        server.timeout(req, 0)
    }
    return response
}
