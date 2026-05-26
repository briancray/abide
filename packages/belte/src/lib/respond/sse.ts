/*
Wraps an AsyncIterable<Frame> in a Response whose body is
Server-Sent Events (text/event-stream) — each frame becomes one
`data: <json>\n\n` event. Used inside an rpc handler to expose a
generator over plain HTTP so EventSource (or `subscribe(fn)(args)` on the
client) can consume it frame-by-frame.

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
import type { TypedResponse } from '../types/TypedResponse.ts'

const KEEPALIVE_INTERVAL_MS = 15000

export function sse<Frame>(iterable: AsyncIterable<Frame>): TypedResponse<Frame> {
    const encoder = new TextEncoder()
    const iterator = iterable[Symbol.asyncIterator]()
    let keepaliveTimer: ReturnType<typeof setInterval> | undefined

    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            keepaliveTimer = setInterval(() => {
                controller.enqueue(encoder.encode(': keepalive\n\n'))
            }, KEEPALIVE_INTERVAL_MS)
        },
        async pull(controller) {
            try {
                const next = await iterator.next()
                if (next.done) {
                    clearInterval(keepaliveTimer)
                    controller.close()
                    return
                }
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value)}\n\n`))
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                controller.enqueue(
                    encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`),
                )
                clearInterval(keepaliveTimer)
                controller.close()
            }
        },
        cancel(reason) {
            clearInterval(keepaliveTimer)
            return iterator.return?.(reason)?.then(() => undefined)
        },
    })

    return new Response(body, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            Connection: 'keep-alive',
        },
    }) as TypedResponse<Frame>
}
