/*
Wraps an AsyncIterable<Frame> in a Response whose body is JSON Lines
(application/jsonl) — one JSON value per line, terminated by `\n`. Used
inside an rpc handler to turn a generator into a streaming HTTP response
that `subscribe(fn)(args)` consumes frame-by-frame on the client.

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
import type { TypedResponse } from '../types/TypedResponse.ts'

export function jsonl<Frame>(iterable: AsyncIterable<Frame>): TypedResponse<Frame> {
    const encoder = new TextEncoder()
    const iterator = iterable[Symbol.asyncIterator]()

    const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const next = await iterator.next()
                if (next.done) {
                    controller.close()
                    return
                }
                controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`))
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                controller.enqueue(encoder.encode(`${JSON.stringify({ $error: message })}\n`))
                controller.close()
            }
        },
        cancel(reason) {
            return iterator.return?.(reason)?.then(() => undefined)
        },
    })

    return new Response(body, {
        headers: {
            'Content-Type': 'application/jsonl; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    }) as TypedResponse<Frame>
}
