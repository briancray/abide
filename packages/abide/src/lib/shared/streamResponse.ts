import { contentTypeOf } from './contentTypeOf.ts'
import { decodeResponse } from './decodeResponse.ts'
import { HttpError } from './HttpError.ts'
import { jsonlErrorFrame } from './jsonlErrorFrame.ts'
import { STREAMING_CONTENT_TYPES } from './STREAMING_CONTENT_TYPES.ts'
import { sseErrorFrame } from './sseErrorFrame.ts'

/*
Turns a Response into an AsyncIterable of frames, regardless of the
handler's chosen body format. Shared by `fn.stream(args)` (via
subscribableFromResponse), the CLI's streaming print path, and the MCP
tool dispatcher's stream drain — so every surface consumes sse/jsonl
identically. Three shapes are handled:

- text/event-stream (SSE): emits the JSON-parsed `data:` payload of
  each event. The `event: error\ndata: {message}` frame the `sse()`
  helper emits on generator throws is mapped back to a thrown Error so
  consumers see the failure mid-iteration.
- application/jsonl + application/x-ndjson: emits one JSON value per
  line. The trailing `{"$error":"..."}` line the `jsonl()` helper
  emits on generator throws is likewise re-thrown.
- everything else: one-shot — yields the Content-Type-decoded body
  once, then completes. Lets callers iterate uniformly on every rpc
  handler, not just the streaming ones.

Non-2xx responses surface as a thrown HttpError on the first pull,
mirroring the plain `fn(args)` decode path.
*/
export function streamResponse<T>(response: Response): AsyncIterable<T> {
    if (!response.ok) {
        return errorIterable<T>(new HttpError(response))
    }
    const contentType = contentTypeOf(response.headers)
    if (contentType.startsWith('text/event-stream')) {
        return parseSse<T>(response)
    }
    if (STREAMING_CONTENT_TYPES.some((type) => contentType.startsWith(type))) {
        return parseJsonLines<T>(response)
    }
    return oneShot<T>(response)
}

/* Surfaces a non-2xx response (or any pre-stream failure) as a thrown error on the first pull. */
// biome-ignore lint/correctness/useYield: throws on first pull; the generator shape is intentional so callers iterate it uniformly
async function* errorIterable<T>(error: Error): AsyncGenerator<T> {
    throw error
}

/*
One-shot iterator over a non-streaming Response: decodes the body once
via the same Content-Type sniffing the plain call uses, yields it, then
completes. Makes streaming symmetrical across streaming and
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
frame. The error sentinel (`sseErrorFrame`) the `sse()` helper emits on a
generator throw is surfaced as a thrown Error so consumer loops can react
to mid-stream failure rather than silently stopping.
*/
async function* parseSse<T>(response: Response): AsyncGenerator<T> {
    for await (const raw of frameReader(response, '\n\n')) {
        const frame = parseFrame(raw)
        if (!frame) {
            continue
        }
        const errorMessage = sseErrorFrame.decode(frame.event, frame.data)
        if (errorMessage !== undefined) {
            throw new Error(errorMessage)
        }
        /* A frame with an empty `data:` value (a keepalive) carries no payload — skip it
           rather than letting JSON.parse('') throw and tear down the whole iteration. */
        if (frame.data === '') {
            continue
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
value. The error sentinel (`jsonlErrorFrame`) the `jsonl()` helper emits as
a trailing line on a generator throw is surfaced here as a thrown Error so
consumer loops can react to mid-stream failure.
*/
async function* parseJsonLines<T>(response: Response): AsyncGenerator<T> {
    for await (const raw of frameReader(response, '\n')) {
        /* Skip blank lines: a CRLF stream yields a lone `\r` (non-zero length) between
           records, and JSON.parse('\r') would throw and tear down the whole iteration. */
        if (raw.trim().length === 0) {
            continue
        }
        const parsed = JSON.parse(raw)
        const errorMessage = jsonlErrorFrame.decode(parsed)
        if (errorMessage !== undefined) {
            throw new Error(errorMessage)
        }
        yield parsed as T
    }
}
