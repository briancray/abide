// Server-Sent Events streaming response (rpc-core §4). Emits a `data: <json>\n\n` frame per item from
// a sync or async iterable, streamed through a ReadableStream.
//
// LAZY (pull-based, HWM 0), exactly like `jsonl.ts`: the source is consumed only as the body is READ,
// and it is tagged see-through with the pre-encoding source. So `GET(() => sse(gen()))` is replayable —
// a cell-backed read taps the raw source to build a ReplayableStream and the discarded, unread Response
// body never drains it (no double-consumption). The `?from=` resume re-encodes as sse (its tagged
// encoding). This makes sse fully isomorphic (SSR-block/seed/resume), on par with jsonl.
//
// The prelude + heartbeat are deferred to the FIRST real read (a discarded body never opens):
//   - `:ok` prelude so `EventSource.onopen` fires on connect rather than waiting for the first message;
//   - a periodic `:\n\n` comment (ignored by every EventSource) after HEARTBEAT_MS of silence, so a
//     long-lived byte-idle subscription (a `socket(...)` HTTP face consumed by CLI/MCP) isn't idle-
//     timed-out. A finite iterable that drains promptly never emits one.
// `cancel` (consumer disconnect) tears the interval down AND returns the source iterator, so a
// subscribing iterable (the socket hub) drops the subscriber instead of leaking it.

import { type StreamResponse, tagResponseSource } from '../shared/internal/responseSource.ts'

const HEARTBEAT_MS = 15_000
const HEARTBEAT = new TextEncoder().encode(':\n\n')
const PRELUDE = new TextEncoder().encode(':ok\n\n')

export function sse<C>(
    iterable: AsyncIterable<C> | Iterable<C>,
    init?: ResponseInit,
): StreamResponse<C> {
    const encoder = new TextEncoder()
    let iterator: AsyncIterator<unknown> | Iterator<unknown> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let opened = false
    const stopHeartbeat = (): void => {
        if (heartbeat !== undefined) {
            clearInterval(heartbeat)
            heartbeat = undefined
        }
    }
    const stream = new ReadableStream<Uint8Array>(
        {
            start() {
                // Obtain the iterator WITHOUT consuming — an async generator's body runs on the first
                // `.next()`, which `pull` (not `start`) makes; a discarded, unread body never pulls, so
                // see-through's raw-source drain is the only consumer.
                const asAsync = iterable as AsyncIterable<unknown>
                iterator =
                    asAsync[Symbol.asyncIterator]?.() ??
                    (iterable as Iterable<unknown>)[Symbol.iterator]()
            },
            async pull(controller) {
                // Open on the FIRST real read: flush the prelude and arm the heartbeat (see file header).
                if (!opened) {
                    opened = true
                    controller.enqueue(PRELUDE)
                    heartbeat = setInterval(() => {
                        try {
                            controller.enqueue(HEARTBEAT)
                        } catch {
                            stopHeartbeat()
                        }
                    }, HEARTBEAT_MS)
                }
                try {
                    const result = await (iterator as AsyncIterator<unknown>).next()
                    if (result.done === true) {
                        stopHeartbeat()
                        controller.close()
                    } else {
                        controller.enqueue(
                            encoder.encode(`data: ${JSON.stringify(result.value)}\n\n`),
                        )
                    }
                } catch (caught) {
                    stopHeartbeat()
                    controller.error(caught)
                }
            },
            async cancel() {
                stopHeartbeat()
                await (iterator as AsyncIterator<unknown>)?.return?.(undefined)
            },
        },
        { highWaterMark: 0 },
    )
    const headers = new Headers(init?.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'text/event-stream')
    // Tag with the pre-encoding source so a cell-backed read is REPLAYABLE (replayable-streams.md §4);
    // the router re-encodes the replayed transcript as sse (its tagged encoding) on `?from=` resume.
    return tagResponseSource(new Response(stream, { ...init, headers }), {
        kind: 'stream',
        source: iterable,
        encoding: 'sse',
    }) as StreamResponse<C>
}
