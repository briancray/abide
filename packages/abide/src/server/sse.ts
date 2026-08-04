// Server-Sent Events streaming response (rpc-core §4). Emits a `data: <json>\n\n` frame per item from
// a sync or async iterable, streamed through a ReadableStream.
//
// LAZY (pull-based, HWM 0), exactly like `jsonl.ts` — and now literally so: the pull machine is the
// shared `framedStream`, so the see-through contract is one implementation rather than two that agree
// today. The source is consumed only as the body is READ, and it is tagged see-through with the
// pre-encoding source. So `GET(() => sse(gen()))` is replayable — a memo-backed read taps the raw
// source to build a ReplayableStream and the discarded, unread Response body never drains it (no
// double-consumption). The `?__abide_from=` resume re-encodes as sse (its tagged encoding). This makes
// sse fully isomorphic (SSR-block/seed/resume), on par with jsonl.
//
// What sse adds over jsonl is the pair of lifecycle hooks, deferred to the FIRST real read (a
// discarded body never opens, so it never arms a timer nobody will clear):
//   - `:ok` prelude so `EventSource.onopen` fires on connect rather than waiting for the first message;
//   - a periodic `:\n\n` comment (ignored by every EventSource) after HEARTBEAT_MS of silence, so a
//     long-lived byte-idle subscription (a `socket(...)` HTTP face consumed by CLI/MCP) isn't idle-
//     timed-out. A finite iterable that drains promptly never emits one.
// `close` runs on every terminal — drain, error, and consumer disconnect — so the interval is torn
// down and `framedStream`'s own `cancel` still returns the source iterator, which is what makes a
// subscribing iterable (the socket hub) drop the subscriber instead of leaking it.

import { framedStream } from '../shared/internal/framedStream.ts'
import { type StreamResponse, tagResponseSource } from '../shared/internal/responseSource.ts'

const HEARTBEAT_MS = 15_000
const encoder = new TextEncoder()
const HEARTBEAT = encoder.encode(':\n\n')
const PRELUDE = encoder.encode(':ok\n\n')

export function sse<C>(
    iterable: AsyncIterable<C> | Iterable<C>,
    init?: ResponseInit,
): StreamResponse<C> {
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const stopHeartbeat = (): void => {
        if (heartbeat !== undefined) {
            clearInterval(heartbeat)
            heartbeat = undefined
        }
    }
    const stream = framedStream(
        iterable,
        (value) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
        {
            open: (controller) => {
                controller.enqueue(PRELUDE)
                heartbeat = setInterval(() => {
                    try {
                        controller.enqueue(HEARTBEAT)
                    } catch {
                        stopHeartbeat()
                    }
                }, HEARTBEAT_MS)
            },
            close: stopHeartbeat,
        },
    )
    const headers = new Headers(init?.headers)
    if (!headers.has('content-type')) headers.set('content-type', 'text/event-stream')
    // Defeat intermediary buffering of a live event stream: `no-cache` keeps proxies/browsers from
    // holding the stream, and nginx's `X-Accel-Buffering: no` disables its response buffering.
    if (!headers.has('cache-control')) headers.set('cache-control', 'no-cache')
    if (!headers.has('x-accel-buffering')) headers.set('x-accel-buffering', 'no')
    // Tag with the pre-encoding source so a memo-backed read is REPLAYABLE (replayable-streams.md §4);
    // the router re-encodes the replayed transcript as sse (its tagged encoding) on `?__abide_from=` resume.
    return tagResponseSource(new Response(stream, { ...init, headers }), {
        kind: 'stream',
        source: iterable,
        encoding: 'sse',
    }) as StreamResponse<C>
}
