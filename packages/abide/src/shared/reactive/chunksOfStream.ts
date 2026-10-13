import { isFailed } from '../Failed.ts'
import { chunksFrom, wakeOf } from './Reactive.ts'

/**
 * The chunks of a streaming value, as they land, ending when its run closes.
 *
 * WHAT A READ WOULD SERVE, chunk by chunk (16.32), rather than the ring `for await` walks: a gated
 * value's chunks are its gated accumulation's (9.8). A cursor is the wake and the settling is the
 * end (`Cursor.closeOn`).
 */
export async function* chunksOfStream(value: unknown): AsyncGenerator<unknown> {
    const cursor = wakeOf(value)
    cursor.closeOn(Promise.resolve(value as PromiseLike<unknown>))
    let sent = 0
    try {
        for (;;) {
            for (const chunk of chunksFrom(value, sent)) {
                sent += 1
                yield chunk
            }
            if (cursor.closed) break
            await cursor.turn()
        }
    } finally {
        cursor.stop()
    }
    if (cursor.failure !== undefined) throw cursor.failure
    // 16.59, 16.60 — A RUN ENDED BY ITS TIMEOUT SETTLES with the chunks it had and holds its refusal
    // rather than rejecting, so the refusal is read off the value and thrown after them: a stream
    // answered over http then ends on it (16.68) rather than as though it had finished.
    const held = (value as { error?: () => unknown }).error?.()
    if (isFailed(held)) throw held
}
