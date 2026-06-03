import type { Server } from 'bun'

/*
The Content-Types the framework's streaming helpers emit (sse → event-stream,
jsonl → jsonl). The socket SSE tail reuses sse(), so it carries event-stream
too. Detection keys off these rather than `response.body instanceof
ReadableStream`, because every bodied Response (including Response.json)
exposes its body as a ReadableStream — content type is the honest signal for
an incrementally-produced body.
*/
const STREAMING_CONTENT_TYPES = ['text/event-stream', 'application/jsonl']

/*
Opts a streaming response out of Bun's per-connection idle timeout. A stream
can stay quiet for longer than the 10s default between frames, which Bun would
otherwise read as an idle connection and close mid-stream. `server.timeout(req,
0)` clears the timeout for just this in-flight request, leaving the global
default in place for ordinary request/response traffic. Non-stream responses
pass through untouched.
*/
export function disableIdleTimeoutForStream(
    server: Server<unknown>,
    req: Request,
    response: Response,
): Response {
    const contentType = response.headers.get('content-type') ?? ''
    if (STREAMING_CONTENT_TYPES.some((type) => contentType.startsWith(type))) {
        server.timeout(req, 0)
    }
    return response
}
