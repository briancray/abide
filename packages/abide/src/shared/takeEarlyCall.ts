// 41.21 — A CALL THE PAGE ALREADY STARTED IS TAKEN, NOT MADE AGAIN. What a server-rendered page's
// early-call script (41.20) left for one request, handed to the first reader that asks for it and to
// no other: a handler's `wire`, and the principal's document (26.17), which is a handler abide mounts.

import { EARLY_CALLS } from './EARLY_CALLS.ts'

/**
 * What a call answered: the status and the text — which stays unset where the request itself did
 * not complete.
 */
export type Answer = {
    status: number | undefined
    statusText: string | undefined
    type: string | null | undefined
    /**
     * The answer's version, or `null` where it named none (18.20).
     *
     * A `null` is a value built per request.
     */
    version: string | null | undefined
    /** The answer's `cache-control`, whose `max-age` is how long the copy may serve it (21.8). */
    life: string | null | undefined
    text: string | undefined
    /**
     * A streamed answer's body, left unread so its chunks are taken as they land (16.33).
     *
     * Set in place of `text` for a handler the build marked as streaming, and by the early-call
     * script for any framed answer.
     */
    body: ReadableStream<Uint8Array> | null | undefined
}

/**
 * What the early-call script leaves per call: the request in flight, and once it has answered, what
 * it answered.
 */
export type EarlyCall = Answer & { promise: Promise<void> }

/** The call the page started under `key`, taken so no later reader is answered from it. */
export function takeEarlyCall(key: string): EarlyCall | undefined {
    const started = (
        globalThis as unknown as Record<
            string,
            Record<string, EarlyCall | undefined> | undefined
        >
    )[EARLY_CALLS]
    const early = started?.[key]
    if (early !== undefined)
        (started as Record<string, EarlyCall | undefined>)[key] = undefined
    return early
}
