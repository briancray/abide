import type { Subscribable } from './types/Subscribable.ts'
import { decodeResponse } from './decodeResponse.ts'
import { HttpError } from '../server/respond/HttpError.ts'
import { STREAMING_CONTENT_TYPES } from './streamingContentTypes.ts'

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
        return errorIterable(new HttpError(response))
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

function errorIterable<T>(error: Error): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
            let done = false
            return {
                async next() {
                    if (done) {
                        return { value: undefined, done: true }
                    }
                    done = true
                    throw error
                },
                async return() {
                    done = true
                    return { value: undefined, done: true }
                },
            }
        },
    }
}

/*
One-shot iterator over a non-streaming Response: decodes the body once
via the same Content-Type sniffing the plain call uses, yields it, then
completes. Makes `fn.stream(args)` symmetrical across streaming and
non-streaming handlers — callers can pick the iteration shape without
worrying about which body the handler returned.
*/
function oneShot<T>(response: Response): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
            let yielded = false
            return {
                async next() {
                    if (yielded) {
                        return { value: undefined, done: true }
                    }
                    yielded = true
                    const value = (await decodeResponse(response)) as T
                    return { value, done: false }
                },
                async return() {
                    yielded = true
                    return { value: undefined, done: true }
                },
            }
        },
    }
}

/*
SSE parser: reads the response body as text frames separated by blank
lines, splits each frame into `event:` / `data:` lines, and yields the
JSON-parsed data payload. The `sse()` respond helper emits an
`event: error\ndata: {"message":...}` frame when the source generator
throws, which we surface as a thrown Error so consumer loops can
surface mid-stream failure rather than silently stopping.
*/
function parseSse<T>(response: Response): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
            const body = response.body
            if (!body) {
                return emptyIterator<T>()
            }
            const reader = body.pipeThrough(new TextDecoderStream()).getReader()
            let buffer = ''
            let bufferStart = 0
            const pending: Array<{ event: string; data: string }> = []
            let done = false

            async function pullFrames(): Promise<void> {
                while (pending.length === 0 && !done) {
                    const { value, done: streamDone } = await reader.read()
                    if (streamDone) {
                        done = true
                        if (bufferStart < buffer.length) {
                            const frame = parseFrame(buffer.slice(bufferStart))
                            if (frame) {
                                pending.push(frame)
                            }
                            buffer = ''
                            bufferStart = 0
                        }
                        return
                    }
                    /*
                    Compact only when the unread region is small relative to
                    the consumed prefix — keeps amortised work O(n) instead
                    of quadratic slicing per frame boundary.
                    */
                    if (bufferStart > buffer.length / 2) {
                        buffer = buffer.slice(bufferStart) + value
                        bufferStart = 0
                    } else {
                        buffer += value
                    }
                    let boundary = buffer.indexOf('\n\n', bufferStart)
                    while (boundary !== -1) {
                        const raw = buffer.slice(bufferStart, boundary)
                        bufferStart = boundary + 2
                        const frame = parseFrame(raw)
                        if (frame) {
                            pending.push(frame)
                        }
                        boundary = buffer.indexOf('\n\n', bufferStart)
                    }
                }
            }

            return {
                async next() {
                    while (true) {
                        if (pending.length > 0) {
                            const next = pending.shift() as { event: string; data: string }
                            if (next.event === 'error') {
                                try {
                                    const decoded = JSON.parse(next.data) as { message?: string }
                                    throw new Error(decoded?.message ?? 'sse stream error')
                                } catch (err) {
                                    if (err instanceof SyntaxError) {
                                        throw new Error(next.data || 'sse stream error')
                                    }
                                    throw err
                                }
                            }
                            const value = JSON.parse(next.data) as T
                            return { value, done: false }
                        }
                        if (done) {
                            return { value: undefined, done: true }
                        }
                        await pullFrames()
                    }
                },
                async return() {
                    done = true
                    await reader.cancel().catch(() => undefined)
                    return { value: undefined, done: true }
                },
            }
        },
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
JSONL/NDJSON parser: reads the response body as text, splits on `\n`,
parses each non-empty line as JSON, and yields the value. The `jsonl()`
respond helper emits a trailing `{"$error":"<message>"}` line when the
source generator throws — that's surfaced here as a thrown Error so
consumer loops can react to mid-stream failure.
*/
function parseJsonLines<T>(response: Response): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator](): AsyncIterator<T, void, undefined> {
            const body = response.body
            if (!body) {
                return emptyIterator<T>()
            }
            const reader = body.pipeThrough(new TextDecoderStream()).getReader()
            let buffer = ''
            let bufferStart = 0
            const pending: string[] = []
            let done = false

            async function pullLines(): Promise<void> {
                while (pending.length === 0 && !done) {
                    const { value, done: streamDone } = await reader.read()
                    if (streamDone) {
                        done = true
                        if (bufferStart < buffer.length) {
                            pending.push(buffer.slice(bufferStart))
                            buffer = ''
                            bufferStart = 0
                        }
                        return
                    }
                    if (bufferStart > buffer.length / 2) {
                        buffer = buffer.slice(bufferStart) + value
                        bufferStart = 0
                    } else {
                        buffer += value
                    }
                    let newline = buffer.indexOf('\n', bufferStart)
                    while (newline !== -1) {
                        const line = buffer.slice(bufferStart, newline)
                        bufferStart = newline + 1
                        if (line.length > 0) {
                            pending.push(line)
                        }
                        newline = buffer.indexOf('\n', bufferStart)
                    }
                }
            }

            return {
                async next() {
                    while (true) {
                        if (pending.length > 0) {
                            const line = pending.shift() as string
                            const parsed = JSON.parse(line) as Record<string, unknown> & {
                                $error?: string
                            }
                            if (
                                parsed &&
                                typeof parsed === 'object' &&
                                typeof parsed.$error === 'string'
                            ) {
                                throw new Error(parsed.$error)
                            }
                            return { value: parsed as T, done: false }
                        }
                        if (done) {
                            return { value: undefined, done: true }
                        }
                        await pullLines()
                    }
                },
                async return() {
                    done = true
                    await reader.cancel().catch(() => undefined)
                    return { value: undefined, done: true }
                },
            }
        },
    }
}

function emptyIterator<T>(): AsyncIterator<T, void, undefined> {
    return {
        async next() {
            return { value: undefined, done: true }
        },
        async return() {
            return { value: undefined, done: true }
        },
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
            return {
                async next() {
                    if (!inner) {
                        const response = await fetchResponse()
                        inner = streamResponse<T>(response)[Symbol.asyncIterator]()
                    }
                    return inner.next()
                },
                async return() {
                    await inner?.return?.(undefined)
                    return { value: undefined, done: true }
                },
            }
        },
    }
}
