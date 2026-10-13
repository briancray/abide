import { isFailed } from '../Failed.ts'
import { chunksFrom } from './Reactive.ts'

/**
 * The chunks of a streaming value, as they land, ending when its run closes.
 *
 * The live cursor is the wake and not the source: a cursor outlives the run (it waits on the next
 * one), and a chunk landing in the same turn as the close could be lost to whichever settled first
 * — so each wake sends what the accumulation holds past what has already gone, and the close sends
 * the rest.
 */
export async function* chunksOfStream(value: unknown): AsyncGenerator<unknown> {
    const stream = value as PromiseLike<unknown> & AsyncIterable<unknown>
    let closed = false
    let failure: unknown
    // ONE REACTION ON THE CLOSE FOR THE WHOLE STREAM, which wakes whichever wait is current. A
    // `Promise.race` against the close per chunk left one reaction per chunk on it, held until the
    // stream ended.
    let wake: () => void = () => {}
    void Promise.resolve(stream).then(
        () => {
            closed = true
            wake()
        },
        (error: unknown) => {
            closed = true
            failure = error
            wake()
        },
    )
    const cursor = stream[Symbol.asyncIterator]()
    let sent = 0
    let woken = cursor.next()
    try {
        for (;;) {
            if (!closed)
                await new Promise<void>((resolve, reject) => {
                    wake = resolve
                    woken.then(() => resolve(), reject)
                })
            for (const chunk of chunksFrom(value, sent)) {
                sent += 1
                yield chunk
            }
            if (closed) break
            woken = cursor.next()
        }
    } finally {
        void cursor.return?.(undefined)
    }
    if (failure !== undefined) throw failure
    // 16.59, 16.60 — A RUN ENDED BY ITS TIMEOUT SETTLES with the chunks it had and holds its refusal
    // rather than rejecting, so the refusal is read off the value and thrown after them: a stream
    // answered over http then ends on it (16.68) rather than as though it had finished.
    const held = (value as { error?: () => unknown }).error?.()
    if (isFailed(held)) throw held
}
