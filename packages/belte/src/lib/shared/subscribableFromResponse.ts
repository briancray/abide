import { HttpError } from '../server/HttpError.ts'
import { decodeResponse } from './decodeResponse.ts'
import { STREAMING_CONTENT_TYPES } from './streamingContentTypes.ts'
import type { Subscribable } from './types/Subscribable.ts'

/*
Turns a Response into an AsyncIterable of frames. Used by
`fn.stream(args)` to give callers a uniform iterator regardless of the
handler's chosen body format. Three shapes are handled:

- text/event-stream (SSE): emits the JSON-parsed `data:` payload of
  each event. The `event: error\ndata: {message}` frame the `sse()`
  helper emits on generator throws is mapped back to a thrown Error so
  consumers see the failure mid-iteration.
- application/jsonl + application/x-ndjson: emits one JSON value per
  line. The trailing `{"$error":"..."}` line the `jsonl()` helper
  emits on generator throws is likewise re-thrown.
- everything else: one-shot — yields the Content-Type-decoded body
  once, then completes. Lets `fn.stream(args)` work uniformly on every
  rpc handler, not just the streaming ones.

Non-2xx responses surface as a thrown HttpError on the first pull,
mirroring the plain `fn(args)` decode path.
*/
function streamResponse<T>(response: Response): AsyncIterable<T> {
    if (!response.ok) {
        return errorIterable<T>(new HttpError(response))
    }
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
    if (contentType.startsWith('text/event-stream')) {
        return parseSse<T>(response)
    }
    if (STREAMING_CONTENT_TYPES.some((type) => contentType.startsWith(type))) {
        return parseJsonLines<T>(response)
    }
    return oneShot<T>(response)
}

/* Surfaces a non-2xx response (or any pre-stream failure) as a thrown error on the first pull. */
async function* errorIterable<T>(error: Error): AsyncGenerator<T> {
    throw error
}

/*
One-shot iterator over a non-streaming Response: decodes the body once
via the same Content-Type sniffing the plain call uses, yields it, then
completes. Makes `fn.stream(args)` symmetrical across streaming and
non-streaming handlers — callers can pick the iteration shape without
worrying about which body the handler returned.
*/
async function* oneShot<T>(response: Response): AsyncGenerator<T> {
    yield (await decodeResponse(response)) as T
}

/*
Reads a streaming text Response and yields raw frame strings split on
`delimiter` (`\n\n` for SSE events, `\n` for JSON lines). Owns the whole
buffering lifecycle: incremental decode, amortised-O(n) compaction, a
final flush of the trailing partial frame, and reader cancellation when
the consumer stops iterating (the generator's `finally` runs on
`return()`). The SSE and jsonl parsers layer their per-frame parsing on
top of this single machine so the two can't drift.
*/
async function* frameReader(response: Response, delimiter: string): AsyncGenerator<string> {
    const body = response.body
    if (!body) {
        return
    }
    const reader = body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    let bufferStart = 0
    try {
        while (true) {
            const { value, done } = await reader.read()
            if (done) {
                if (bufferStart < buffer.length) {
                    yield buffer.slice(bufferStart)
                }
                return
            }
            /*
            Compact only when the unread region is small relative to the
            consumed prefix — keeps amortised work O(n) instead of
            quadratic slicing per frame boundary.
            */
            if (bufferStart > buffer.length / 2) {
                buffer = buffer.slice(bufferStart) + value
                bufferStart = 0
            } else {
                buffer += value
            }
            let boundary = buffer.indexOf(delimiter, bufferStart)
            while (boundary !== -1) {
                yield buffer.slice(bufferStart, boundary)
                bufferStart = boundary + delimiter.length
                boundary = buffer.indexOf(delimiter, bufferStart)
            }
        }
    } finally {
        await reader.cancel().catch(() => undefined)
    }
}

/*
SSE parser: yields the JSON-parsed `data` payload of each `event:`/`data:`
frame. The `sse()` respond helper emits an `event: error\ndata:
{"message":...}` frame when the source generator throws, which we surface
as a thrown Error so consumer loops can react to mid-stream failure
rather than silently stopping.
*/
async function* parseSse<T>(response: Response): AsyncGenerator<T> {
    for await (const raw of frameReader(response, '\n\n')) {
        const frame = parseFrame(raw)
        if (!frame) {
            continue
        }
        if (frame.event === 'error') {
            try {
                const decoded = JSON.parse(frame.data) as { message?: string }
                throw new Error(decoded?.message ?? 'sse stream error')
            } catch (err) {
                if (err instanceof SyntaxError) {
                    throw new Error(frame.data || 'sse stream error')
                }
                throw err
            }
        }
        yield JSON.parse(frame.data) as T
    }
}

function parseFrame(raw: string): { event: string; data: string } | undefined {
    const lines = raw.split('\n').filter((line) => line.length > 0 && !line.startsWith(':'))
    if (lines.length === 0) {
        return undefined
    }
    let event = 'message'
    const dataLines: string[] = []
    for (const line of lines) {
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') {
            event = value
        } else if (field === 'data') {
            dataLines.push(value)
        }
    }
    if (dataLines.length === 0) {
        return undefined
    }
    return { event, data: dataLines.join('\n') }
}

/*
JSONL/NDJSON parser: parses each non-empty line as JSON and yields the
value. The `jsonl()` respond helper emits a trailing
`{"$error":"<message>"}` line when the source generator throws — that's
surfaced here as a thrown Error so consumer loops can react to mid-stream
failure.
*/
async function* parseJsonLines<T>(response: Response): AsyncGenerator<T> {
    for await (const raw of frameReader(response, '\n')) {
        if (raw.length === 0) {
            continue
        }
        const parsed = JSON.parse(raw) as Record<string, unknown> & { $error?: string }
        if (parsed && typeof parsed === 'object' && typeof parsed.$error === 'string') {
            throw new Error(parsed.$error)
        }
        yield parsed as T
    }
}

/*
Builds the Subscribable returned by `fn.stream(args)`. The carried
`name` is the cache-style key for (method, url, args) so subscribe()
dedupes multiple subscribers to identical args into one underlying
fetch. The fetch is deferred until the first iterator pull so simply
constructing the Subscribable (which happens on every $derived
re-evaluation) doesn't open a connection — subscribe()'s registry
short-circuits the second instance before it iterates.
*/
export function subscribableFromResponse<T>(
    name: string,
    fetchResponse: () => Promise<Response>,
): Subscribable<T> {
    return {
        name,
        [Symbol.asyncIterator]() {
            let inner: AsyncIterator<T, void, undefined> | undefined
            let cancelled = false
            return {
                async next() {
                    if (cancelled) {
                        return { value: undefined, done: true }
                    }
                    if (!inner) {
                        const response = await fetchResponse()
                        inner = streamResponse<T>(response)[Symbol.asyncIterator]()
                        /*
                        If return() landed while we were awaiting the
                        fetch, `inner` was still undefined then so its
                        reader was never cancelled — release the body now
                        rather than leaving the HTTP stream open.
                        */
                        if (cancelled) {
                            await inner.return?.(undefined)
                            return { value: undefined, done: true }
                        }
                    }
                    return inner.next()
                },
                async return() {
                    cancelled = true
                    await inner?.return?.(undefined)
                    return { value: undefined, done: true }
                },
            }
        },
    }
}
