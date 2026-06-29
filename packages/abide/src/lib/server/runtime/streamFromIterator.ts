import { messageFromError } from '../../shared/messageFromError.ts'

/*
Shared body builder for the streaming respond helpers (`jsonl`, `sse`).
Both flow the same shape — pull from an AsyncIterator, encode each frame
to bytes, emit a sentinel `error` frame on a generator throw, and route
ReadableStream's `cancel` into `iterator.return()` so the handler's
`for await` exits via its normal control path. Only the per-frame
encoding and the optional keepalive payload differ between the two.

Keepalive is opt-in: SSE uses `: keepalive\n\n` every 15s so proxies
don't drop an idle connection; jsonl has no spec-defined comment, so it
omits keepalive entirely.
*/

export type StreamEncoder<T> = {
    encodeFrame: (value: T) => string
    encodeError: (message: string) => string
    keepaliveMs?: number
    keepalivePayload?: string
}

export function streamFromIterator<T>(
    iterable: AsyncIterable<T>,
    encoder: StreamEncoder<T>,
): ReadableStream<Uint8Array> {
    const textEncoder = new TextEncoder()
    const iterator = iterable[Symbol.asyncIterator]()
    let keepalive: ReturnType<typeof setInterval> | undefined

    function stopKeepalive(): void {
        if (keepalive !== undefined) {
            clearInterval(keepalive)
            keepalive = undefined
        }
    }

    return new ReadableStream<Uint8Array>({
        start(controller) {
            if (encoder.keepaliveMs !== undefined && encoder.keepalivePayload !== undefined) {
                const payload = textEncoder.encode(encoder.keepalivePayload)
                keepalive = setInterval(() => {
                    /*
                    Every close/cancel path clears this interval synchronously,
                    so a tick can't normally hit a closed controller — but
                    enqueue throws on a closed/errored stream, and an uncaught
                    throw in a timer crashes the process. Guard + self-stop.
                    */
                    /*
                    Skip the tick under backpressure: a stalled consumer leaves
                    desiredSize <= 0, and enqueuing anyway grows the internal
                    queue unbounded. null = no HWM set, > 0 = consumer keeping up.
                    */
                    if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                        return
                    }
                    try {
                        controller.enqueue(payload)
                    } catch {
                        stopKeepalive()
                    }
                }, encoder.keepaliveMs)
            }
        },
        async pull(controller) {
            try {
                const next = await iterator.next()
                if (next.done) {
                    stopKeepalive()
                    controller.close()
                    return
                }
                controller.enqueue(textEncoder.encode(encoder.encodeFrame(next.value)))
            } catch (error) {
                const message = messageFromError(error)
                controller.enqueue(textEncoder.encode(encoder.encodeError(message)))
                stopKeepalive()
                controller.close()
            }
        },
        cancel(reason) {
            stopKeepalive()
            /*
            Route cancel into the generator's normal exit, but swallow a
            rejection from its cleanup: a `finally` that throws on `.return()`
            would otherwise surface as an unhandled rejection (process-fatal
            under Bun's default) on a client disconnect — a path every
            sse/jsonl stream hits routinely.
            */
            return iterator.return?.(reason)?.then(
                () => undefined,
                () => undefined,
            )
        },
    })
}
