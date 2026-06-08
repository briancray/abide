/*
Wraps an AsyncIterable<Frame> in a Response whose body is
Server-Sent Events (text/event-stream) — each frame becomes one
`data: <json>\n\n` event. Used inside an rpc handler to expose a
generator over plain HTTP so EventSource (or `subscribe(fn.stream)(args)`
on the client) can consume it frame-by-frame.

  export const orderFeed = GET<Args>((args) =>
      sse(async function* () {
          for await (const order of db.watchOrders(args)) yield order
      }())
  )

A 15s keepalive comment (`: keepalive\n\n`) is sent between frames so
intermediaries (proxies, load balancers) don't drop an idle connection.
Comments are ignored by EventSource per the spec, so they're invisible to
consumers.

Cancellation flows from the consumer through ReadableStream's `cancel`
into `iter.return()` so the handler's `for await` exits via its normal
control path. Errors are emitted as an `event: error` frame carrying only
the message (full error logged server-side) before the stream closes;
EventSource surfaces this via its `error` listener and `subscribe()`
maps it to the entry's `error` field.
*/
import { NO_STORE } from '../shared/CACHE_CONTROL_VALUES.ts'
import { sseErrorFrame } from '../shared/sseErrorFrame.ts'
import type { TypedResponse } from './rpc/types/TypedResponse.ts'
import { streamFromIterator } from './runtime/streamFromIterator.ts'
import { withResponseDefaults } from './runtime/withResponseDefaults.ts'

const KEEPALIVE_INTERVAL_MS = 15000

export function sse<Frame>(
    iterable: AsyncIterable<Frame>,
    init?: ResponseInit,
): TypedResponse<Frame> {
    const body = streamFromIterator(iterable, {
        encodeFrame: (value) => `data: ${JSON.stringify(value)}\n\n`,
        encodeError: (message) => sseErrorFrame.encode(message),
        keepaliveMs: KEEPALIVE_INTERVAL_MS,
        keepalivePayload: ': keepalive\n\n',
    })
    return new Response(
        body,
        withResponseDefaults(init, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': NO_STORE,
            'X-Content-Type-Options': 'nosniff',
            Connection: 'keep-alive',
        }),
    ) as TypedResponse<Frame>
}
