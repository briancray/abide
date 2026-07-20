// Client-side inverse of the `jsonl`/`sse` transport encoders (replayable-streams.md §4): decode a
// streaming RPC `Response` body into an `AsyncIterable` of chunks, dispatched by `content-type`. The
// RPC client proxy returns this from a read whose response is a stream, so `cell.isStreamSource` routes
// it to a `ReplayableStream` slot — the browser consumes a streaming read exactly like the server does
// (`{#for await x of rpc()}`), with no hand-rolled `fetch`/reader in app code.
//
// It is an async GENERATOR, so a consumer that stops early (unmount, `refresh`, the cell's
// stream-refcount hitting zero → `.return()`) runs the `finally` and cancels the reader — the fetch
// connection is torn down, never leaked. A malformed frame throws (surfaces to `{:catch}`), matching
// the loud-failure posture of the server encoders.

function streamEncodingFor(contentType: string): 'jsonl' | 'sse' | undefined {
    if (contentType.includes('application/jsonl')) return 'jsonl'
    if (contentType.includes('text/event-stream')) return 'sse'
    return undefined
}

// True when a response should be consumed as a stream rather than a single JSON value.
export function isStreamContentType(contentType: string | null): boolean {
    return contentType !== null && streamEncodingFor(contentType) !== undefined
}

// Extract complete `application/jsonl` records from the buffer: one JSON value per `\n`-delimited line.
// Returns the leftover partial line. Throws on a malformed line.
function* drainJsonl(buffer: string): Generator<unknown, string> {
    let rest = buffer
    let newline = rest.indexOf('\n')
    while (newline >= 0) {
        const line = rest.slice(0, newline).trim()
        rest = rest.slice(newline + 1)
        if (line.length > 0) yield JSON.parse(line)
        newline = rest.indexOf('\n')
    }
    return rest
}

// Extract complete `text/event-stream` frames (`\n\n`-delimited) from the buffer, yielding the parsed
// JSON of each frame's concatenated `data:` payload. `:`-prefixed comment lines (the `:ok` prelude and
// the heartbeats) are skipped; non-`data:` fields (`event:`/`id:`/`retry:`) are ignored. Returns the
// leftover partial frame. Throws on a malformed `data:` payload.
function* drainSse(buffer: string): Generator<unknown, string> {
    let rest = buffer
    let split = rest.indexOf('\n\n')
    while (split >= 0) {
        const frame = rest.slice(0, split)
        rest = rest.slice(split + 2)
        const data: string[] = []
        for (const raw of frame.split('\n')) {
            if (raw.startsWith(':')) continue
            if (raw.startsWith('data:')) data.push(raw.slice(5).replace(/^ /, ''))
        }
        if (data.length > 0) yield JSON.parse(data.join('\n'))
        split = rest.indexOf('\n\n')
    }
    return rest
}

export async function* decodeStreamResponse(response: Response): AsyncGenerator<unknown> {
    const encoding = streamEncodingFor(response.headers.get('content-type') ?? '')
    if (encoding === undefined) {
        throw new Error('decodeStreamResponse: response is not a jsonl/sse stream')
    }
    if (response.body === null) return
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
        for (;;) {
            const chunk = await reader.read()
            if (chunk.done === true) break
            buffer += decoder.decode(chunk.value, { stream: true })
            buffer = yield* encoding === 'jsonl' ? drainJsonl(buffer) : drainSse(buffer)
        }
        // A jsonl body may end without a trailing newline; flush the final record.
        if (encoding === 'jsonl') {
            const tail = buffer.trim()
            if (tail.length > 0) yield JSON.parse(tail)
        }
    } finally {
        await reader.cancel().catch(() => {})
    }
}
