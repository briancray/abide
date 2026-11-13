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

/** Whether the page started a call under `key` that no reader has taken yet. */
export function startedEarly(key: string): boolean {
    return startedCalls()?.[key] !== undefined
}

/**
 * 41.25 — the calls painted settled a reader took before they answered, which hydration still
 * waits for: taken at a module's import, a call left the page's record before the wait was read.
 */
const TAKEN_IN_FLIGHT: EarlyCall[] = []

/** The call the page started under `key`, taken so no later reader is answered from it. */
export function takeEarlyCall(key: string): EarlyCall | undefined {
    const started = startedCalls()
    const early = started?.[key]
    if (early === undefined) return undefined
    ;(started as Record<string, EarlyCall | undefined>)[key] = undefined
    if (early.painted === 1 && early.response === undefined)
        TAKEN_IN_FLIGHT.push(early)
    return early
}

/**
 * The call the page started under `key`, taken only where the server painted it settled and its
 * answer has landed — what a reader settles at once from (41.27).
 */
export function takeLandedCall(key: string): EarlyCall | undefined {
    const early = startedCalls()?.[key]
    if (early?.painted !== 1 || early.response === undefined) return undefined
    return takeEarlyCall(key)
}

/**
 * What settles once every call the server painted settled has answered, or `undefined` where none
 * is still on its way.
 *
 * 41.25 — WHAT HYDRATION WAITS FOR, so a call the page was painted from is settled when setup
 * reads it rather than in flight — one a reader has taken already among them. The early-call
 * script's promise settles on an answer and on a failed request alike, so a call that fails ends
 * the wait as one that answers does. A call painted loading, and one already answered, are not
 * waited on.
 *
 * AND THE TASK AFTER THE LAST ONE LANDS: a taken call reaches its value through a chain of
 * reactions — `answerOf`'s, the body's, the core's, an adopting value's — and the wait's own
 * reaction on the same promise runs ahead of all but the first, so setup read the value in flight.
 * A task begins once every microtask queued before it has run, however long the chain.
 */
export function paintedCallsLanded(): Promise<unknown> | undefined {
    const waiting: Promise<unknown>[] = []
    for (const early of TAKEN_IN_FLIGHT.splice(0))
        if (early.response === undefined) waiting.push(early.promise)
    const started = startedCalls()
    for (const key in started) {
        const early = started[key]
        if (early?.painted !== 1 || early.response !== undefined) continue
        waiting.push(early.promise)
    }
    return waiting.length === 0
        ? undefined
        : Promise.all(waiting).then(nextTask)
}

/**
 * Settles in the next task: a `MessageChannel` post, which a background tab does not throttle as it
 * does a `setTimeout`.
 */
function nextTask(): Promise<void> {
    return new Promise((done) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => {
            channel.port1.close()
            done()
        }
        channel.port2.postMessage(null)
    })
}
