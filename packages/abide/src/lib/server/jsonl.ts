// JSON Lines (NDJSON) streaming response (rpc-core §4). Emits one JSON value per line
// from a sync or async iterable, streamed through a ReadableStream so large/lazy sources
// never fully buffer in memory.
//
// LAZY (pull-based): the source is consumed only as the body is READ, never eagerly. So a jsonl Response
// that is discarded unread — e.g. when a cell-backed read sees through it to the raw source to build a
// ReplayableStream (replayable-streams.md §4) — never drains that source, avoiding double-consumption.

import { type StreamResponse, tagResponseSource } from '../shared/internal/responseSource.ts'

export function jsonl<C>(
    iterable: AsyncIterable<C> | Iterable<C>,
    init?: ResponseInit,
): StreamResponse<C> {
    const encoder = new TextEncoder()
    let iterator: AsyncIterator<unknown> | Iterator<unknown> | undefined
    const stream = new ReadableStream<Uint8Array>(
        {
            start() {
                // Obtain the iterator WITHOUT consuming — an async generator's body runs on the first `.next()`.
                const asAsync = iterable as AsyncIterable<unknown>
                iterator =
                    asAsync[Symbol.asyncIterator]?.() ??
                    (iterable as Iterable<unknown>)[Symbol.iterator]()
            },
            async pull(controller) {
                try {
                    const result = await (iterator as AsyncIterator<unknown>).next()
                    if (result.done === true) controller.close()
                    else controller.enqueue(encoder.encode(`${JSON.stringify(result.value)}\n`))
                } catch (caught) {
                    controller.error(caught)
                }
            },
            async cancel() {
                await (iterator as AsyncIterator<unknown>)?.return?.(undefined)
            },
            // highWaterMark 0 so the runtime never eagerly pulls to pre-fill the queue — a discarded, unread
            // jsonl Response must NOT consume its source (see-through relies on this).
        },
        { highWaterMark: 0 },
    )
    const headers = new Headers(init?.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'application/jsonl')
    // Tag with the pre-encoding source so a cell-backed read is REPLAYABLE exactly like a handler that
    // returned `iterable` raw (replayable-streams.md §4); the router re-encodes as jsonl after replay. The
    // `StreamResponse<C>` brand carries the chunk type so a read infers `StreamRead<Args, C>`.
    return tagResponseSource(new Response(stream, { ...init, headers }), {
        kind: 'stream',
        source: iterable,
        encoding: 'jsonl',
    }) as StreamResponse<C>
}
