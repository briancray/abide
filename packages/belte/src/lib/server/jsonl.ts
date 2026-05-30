/*
Wraps an AsyncIterable<Frame> in a Response whose body is JSON Lines
(application/jsonl) — one JSON value per line, terminated by `\n`. Used
inside an rpc handler to turn a generator into a streaming HTTP response
that `subscribe(fn.stream)(args)` consumes frame-by-frame on the client.

  export const orderFeed = GET<Args>((args) =>
      jsonl(async function* () {
          for await (const order of db.watchOrders(args)) yield order
      }())
  )

Cancellation flows from the consumer through ReadableStream's `cancel`
into `iter.return()` so the handler's `for await` exits via its normal
control path (DB cursors, file handles, etc. get to release in finally).

Errors thrown by the generator are emitted as a final
`{"$error":"<message>"}` line before the stream closes. The convention
keeps the format JSON-safe and lets the consumer distinguish "stream
ended cleanly" from "handler threw" without a side-channel. The full
error is logged server-side via the framework's error handler — only the
message crosses the wire.
*/
import { NO_STORE } from '../shared/cacheControlValues.ts'
import type { TypedResponse } from './rpc/types/TypedResponse.ts'
import { streamFromIterator } from './runtime/streamFromIterator.ts'
import { withResponseDefaults } from './runtime/withResponseDefaults.ts'

export function jsonl<Frame>(
    iterable: AsyncIterable<Frame>,
    init?: ResponseInit,
): TypedResponse<Frame> {
    const body = streamFromIterator(iterable, {
        encodeFrame: (value) => `${JSON.stringify(value)}\n`,
        encodeError: (message) => `${JSON.stringify({ $error: message })}\n`,
    })
    return new Response(
        body,
        withResponseDefaults(init, {
            'Content-Type': 'application/jsonl; charset=utf-8',
            'Cache-Control': NO_STORE,
            'X-Content-Type-Options': 'nosniff',
        }),
    ) as TypedResponse<Frame>
}
