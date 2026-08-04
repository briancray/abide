// THE LAZY FRAMED STREAM — the body shared by `jsonl()` and `sse()` (rpc-core §4).
//
// Both encoders are the same machine with a different frame: pull one value off an iterable, encode
// it, enqueue it. What is easy to get wrong is not the frame, it is the LAZINESS, and that was stated
// twice — once per encoder — in three coupled pieces that only work together:
//
//   • the iterator is obtained in `start()` but never advanced there, because an async generator's
//     body runs on the first `.next()`, not on `[Symbol.asyncIterator]()`;
//   • `highWaterMark: 0`, so the runtime never pre-fills the queue with a speculative pull;
//   • `pull()` is therefore the ONLY thing that advances the source.
//
// Together they are what makes a discarded, unread Response leave its source untouched — which
// see-through depends on: a memo-backed read taps the raw iterable to build a ReplayableStream and
// throws the Response away, so a single speculative pull here would silently consume the first chunk
// of every streaming rpc and no VALUE test would show it (the chunk is gone before anyone counts).
//
// `open` and `close` are sse's: the `:ok` prelude and the heartbeat interval both have to be armed on
// the FIRST REAL READ (not at construction, or a discarded body would arm a timer nobody cancels) and
// torn down on every exit. jsonl passes neither and pays nothing for them.

export interface FramedStreamHooks {
    // Ran inside the first `pull`, before the first value is requested. Enqueue a prelude here.
    open?: (controller: ReadableStreamDefaultController<Uint8Array>) => void
    // Ran on every terminal — drain, error, and consumer cancel alike. Clear timers here.
    close?: () => void
}

export function framedStream(
    iterable: AsyncIterable<unknown> | Iterable<unknown>,
    frame: (value: unknown) => Uint8Array,
    hooks: FramedStreamHooks = {},
): ReadableStream<Uint8Array> {
    let iterator: AsyncIterator<unknown> | Iterator<unknown> | undefined
    let opened = false
    return new ReadableStream<Uint8Array>(
        {
            start() {
                // Obtain the iterator WITHOUT consuming — see the header.
                const asAsync = iterable as AsyncIterable<unknown>
                iterator =
                    asAsync[Symbol.asyncIterator]?.() ??
                    (iterable as Iterable<unknown>)[Symbol.iterator]()
            },
            async pull(controller) {
                if (!opened) {
                    opened = true
                    hooks.open?.(controller)
                }
                try {
                    const result = await (iterator as AsyncIterator<unknown>).next()
                    if (result.done === true) {
                        hooks.close?.()
                        controller.close()
                    } else {
                        controller.enqueue(frame(result.value))
                    }
                } catch (caught) {
                    hooks.close?.()
                    controller.error(caught)
                }
            },
            async cancel() {
                hooks.close?.()
                await (iterator as AsyncIterator<unknown>)?.return?.(undefined)
            },
        },
        { highWaterMark: 0 },
    )
}
