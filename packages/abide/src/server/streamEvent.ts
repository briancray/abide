// 16.32, 18.20 — AN EVENT STREAM, WRITTEN: the one writer of `text/event-stream` behind a streaming
// handler's sse body and a followed `GET` answered as events. `framing.ts`'s `frameReader` is the
// one reader.

import type { Problem } from '#shared/Failed.ts'
import type { Framed } from '#shared/framing.ts'
import { REFUSAL_KEY } from '#shared/REFUSAL_KEY.ts'

/** AN EVENT STREAM OPENS ON A COMMENT, so a proxy has bytes to pass before the first event. */
export const EVENT_STREAM_OPENER = ':\n\n'

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
