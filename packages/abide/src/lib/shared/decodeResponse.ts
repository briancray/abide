import { HttpError } from './HttpError.ts'
import { isStreamingResponse } from './isStreamingResponse.ts'

/*
Decodes a Response into the natural body value based on Content-Type:
  application/json (or `*\/+json`) → parsed JSON
  text/*                           → string
  204 No Content / empty body      → undefined
  everything else                  → Blob

Non-2xx responses throw HttpError so the happy path never has to check
`.ok` — error handling moves into try/catch (or unhandled exception
propagation), and the success path types as Promise<Return> cleanly.

Streaming Content-Types (SSE / JSONL / NDJSON) throw a clear error
rather than silently doing the wrong thing: response.text() would hang
forever on a never-ending body and response.json() would fail mid-parse.
The error points callers at the right tools — `tail(fn.stream(args))`
for a shared reactive view, or `fn.stream(args)` directly for a fresh
per-call AsyncIterable — both of which know how to consume the body
frame-by-frame.

Callers that need headers, streaming, or per-status branching should use
the `.raw(args)` escape hatch on the remote function instead — that
returns the underlying Response untouched.
*/
export async function decodeResponse(response: Response): Promise<unknown> {
    if (!response.ok) {
        throw new HttpError(response)
    }
    if (response.status === 204) {
        return undefined
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    if (isStreamingResponse(response)) {
        throw new Error(
            `[abide] response at ${response.url} is a stream (${contentType}) — use tail(fn.stream(args)) for a reactive view, or fn.stream(args) for per-call iteration, instead of awaiting the bare call or cache()`,
        )
    }
    if (contentType.includes('json')) {
        return response.json()
    }
    if (contentType.startsWith('text/')) {
        return response.text()
    }
    return response.blob()
}
