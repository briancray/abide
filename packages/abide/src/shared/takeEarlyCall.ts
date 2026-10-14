// 41.21 — A CALL THE PAGE ALREADY STARTED IS TAKEN, NOT MADE AGAIN. What a server-rendered page's
// early-call script (41.20) left for one request, handed to the first reader that asks for it and to
// no other: a handler's `wire`, and the principal's document (26.17), which is a handler abide mounts.

import { EARLY_CALLS } from './EARLY_CALLS.ts'

/**
 * What the early-call script leaves per call: the request in flight, and once it has answered, the
 * `Response`. The script decides nothing about it — `answerOf` reads it as it reads any answer.
 */
export type EarlyCall = {
    promise: Promise<unknown>
    /** `1` where the server built the page's markup from this call settled (41.25). */
    painted: 1 | undefined
    /**
     * Set once the request has answered — and, where `painted`, once its body is read to the end into
     * `bytes`, so hydration's wait covers the body too. Unset where the request failed.
     */
    response: Response | undefined
    bytes: ArrayBuffer | undefined
}

function startedCalls(): Record<string, EarlyCall | undefined> | undefined {
    return (
        globalThis as unknown as Record<
            string,
            Record<string, EarlyCall | undefined> | undefined
        >
    )[EARLY_CALLS]
}

/** The call the page started under `key`, taken so no later reader is answered from it. */
export function takeEarlyCall(key: string): EarlyCall | undefined {
    const started = startedCalls()
    const early = started?.[key]
    if (early !== undefined)
        (started as Record<string, EarlyCall | undefined>)[key] = undefined
    return early
}

/**
 * What settles once every call the server painted settled has answered, or `undefined` where none
 * is still on its way.
 *
 * 41.25 — WHAT HYDRATION WAITS FOR, so a call the page was painted from is settled when setup
 * reads it rather than in flight. The early-call script's promise settles on an answer and on a
 * failed request alike, so a call that fails ends the wait as one that answers does. A call painted
 * loading, and one already answered, are not waited on.
 */
export function paintedCallsLanded(): Promise<unknown> | undefined {
    const started = startedCalls()
    if (started === undefined) return undefined
    let waiting: Promise<unknown>[] | undefined
    for (const key in started) {
        const early = started[key]
        if (early?.painted !== 1 || early.response !== undefined) continue
        if (waiting === undefined) waiting = []
        waiting.push(early.promise)
    }
    return waiting === undefined ? undefined : Promise.all(waiting)
}
