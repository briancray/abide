// 16.32, 18.20 — AN EVENT STREAM, WRITTEN: the one writer of `text/event-stream` behind a streaming
// handler's sse body and a followed `GET` answered as events. `framing.ts`'s `frameReader` is the
// one reader.

import type { Problem } from '#shared/Failed.ts'
import type { Framed } from '#shared/framing.ts'
import { REFUSAL_KEY } from '#shared/REFUSAL_KEY.ts'

import { HEARTBEAT_MILLISECONDS } from './HEARTBEAT_MILLISECONDS.ts'

/** AN EVENT STREAM OPENS ON A COMMENT, so a proxy has bytes to pass before the first event. */
export const EVENT_STREAM_OPENER = new TextEncoder().encode(':\n\n')

/**
 * `body`, read one chunk a pull; `release` runs once it closes, errors or its reader hangs up.
 *
 * 16.57 — `beats`: a comment wherever a read has waited a heartbeat for its next chunk. A COMMENT
 * RATHER THAN AN EVENT: every reader skips one (18.27), and it gives a proxy in front bytes to
 * pass, so neither it nor the reader takes a quiet stream for a dead one. A bridge's reader goes by
 * it too (44.27), where a frame would sit in the pairing's inbox through a drop.
 *
 * BEATS ONLY WHILE A READ WAITS, at a high-water mark of 0: a reader that stalled or never started
 * pulls nothing, so no comment queues behind it and no timer outlives it, and `body` is pulled no
 * further ahead than it was. A read the beat won is kept for the next pull.
 */
export function heldBody(
    body: ReadableStream<Uint8Array>,
    release: () => void,
    beats: boolean,
): ReadableStream<Uint8Array> {
    const reader = body.getReader()
    let pending: ReturnType<typeof reader.read> | undefined
    return new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                pending ??= reader.read()
                let beat: ReturnType<typeof setTimeout> | undefined
                try {
                    const next = beats
                        ? await Promise.race([
                              pending,
                              new Promise<undefined>((quiet) => {
                                  beat = setTimeout(
                                      () => quiet(undefined),
                                      HEARTBEAT_MILLISECONDS,
                                  )
                              }),
                          ])
                        : await pending
                    if (next === undefined)
                        return controller.enqueue(EVENT_STREAM_OPENER)
                    pending = undefined
                    if (!next.done) return controller.enqueue(next.value)
                    controller.close()
                    release()
                } catch (thrown) {
                    controller.error(thrown)
                    release()
                } finally {
                    clearTimeout(beat)
                }
            },
            cancel(reason) {
                release()
                return reader.cancel(reason)
            },
        },
        { highWaterMark: 0 },
    )
}

/**
 * One event: its `event` name and `id` where it has them, and `data` — one line, which JSON is as
 * `JSON.stringify` writes it.
 */
export function streamEvent(
    name: string | undefined,
    id: number | undefined,
    data: string,
): string {
    return `${name === undefined ? '' : `event: ${name}\n`}${id === undefined ? '' : `id: ${id}\n`}data: ${data}\n\n`
}

/** A framed stream's last frame, as the server writes it for a refusal (16.68). */
export function refusalFrame(problem: Problem, framing: Framed): string {
    return framing === 'jsonl'
        ? `${JSON.stringify({ [REFUSAL_KEY]: problem })}\n`
        : streamEvent('refusal', undefined, JSON.stringify(problem))
}
