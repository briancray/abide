// JSON Lines (NDJSON) streaming response (rpc-core §4). Emits one JSON value per line
// from a sync or async iterable, streamed through a ReadableStream so large/lazy sources
// never fully buffer in memory.
//
// LAZY (pull-based): the source is consumed only as the body is READ, never eagerly. So a jsonl Response
// that is discarded unread — e.g. when a memo-backed read sees through it to the raw source to build a
// ReplayableStream (replayable-streams.md §4) — never drains that source, avoiding double-consumption.
// That mechanism is `framedStream`'s, shared with `sse()`; only the frame is this file's.

import { framedStream } from '../shared/internal/framedStream.ts'
import { type StreamResponse, tagResponseSource } from '../shared/internal/responseSource.ts'

const encoder = new TextEncoder()

export function jsonl<C>(
    iterable: AsyncIterable<C> | Iterable<C>,
    init?: ResponseInit,
): StreamResponse<C> {
    const stream = framedStream(iterable, (value) => encoder.encode(`${JSON.stringify(value)}\n`))
    const headers = new Headers(init?.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'application/jsonl')
    // Tag with the pre-encoding source so a memo-backed read is REPLAYABLE exactly like a handler that
    // returned `iterable` raw (replayable-streams.md §4); the router re-encodes as jsonl after replay. The
    // `StreamResponse<C>` brand carries the chunk type so a read infers `StreamRead<Args, C>`.
    return tagResponseSource(new Response(stream, { ...init, headers }), {
        kind: 'stream',
        source: iterable,
        encoding: 'jsonl',
    }) as StreamResponse<C>
}
