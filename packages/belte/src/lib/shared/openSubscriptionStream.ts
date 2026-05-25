import type { RemoteFunction } from '../types/RemoteFunction.ts'
import type { SocketFunction } from '../types/SocketFunction.ts'

export type SubscriptionCallbacks = {
    onFrame(value: unknown): void
    onError(error: Error): void
    onDone(): void
}

export type SubscriptionSource<Args, Frame> =
    | RemoteFunction<Args, Frame>
    | SocketFunction<Args, Frame>

/*
Opens a stream against a SubscriptionSource and forwards frames into
the callbacks. Returns a cleanup that tears the underlying stream down
— used by subscribe() to close the connection when no $derived is
reading the entry anymore.

Both transports share one dispatch path: drain `fn.stream(args)` (an
AsyncIterable in either case) and push values through the callbacks.
The transport-specific concerns — multiplexing onto the shared ws
channel, parsing SSE/JSONL bodies, surfacing HttpError on non-2xx —
live inside the stream method itself (socketProxy / streamResponse).
Subscribe stays oblivious to wire choice.
*/
export function openSubscriptionStream<Args, Frame>(
    fn: SubscriptionSource<Args, Frame>,
    args: Args,
    callbacks: SubscriptionCallbacks,
): () => void {
    const iterator = fn.stream(args)[Symbol.asyncIterator]()
    let cancelled = false
    ;(async () => {
        try {
            while (!cancelled) {
                const next = await iterator.next()
                if (next.done) {
                    if (!cancelled) {
                        callbacks.onDone()
                    }
                    return
                }
                callbacks.onFrame(next.value)
            }
        } catch (error) {
            if (!cancelled) {
                callbacks.onError(error instanceof Error ? error : new Error(String(error)))
            }
        }
    })()
    return () => {
        cancelled = true
        iterator.return?.(undefined)?.catch(() => undefined)
    }
}
