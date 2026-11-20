// 18.33, 46.8, 54.10 — HOW LONG A RETRY WAITS, the one rule every retry abide makes is timed by: the
// browser's outbox and socket mux (`Backoff`) and the server's `fetchText`. Each passes its own floor
// and ceiling; what they share is that the wait doubles from the floor, stops at the ceiling, and is
// never sooner than a `Retry-After` the last answer named (15.23) — that is the server saying "not
// before", and a step of our own longer than that is still ours to wait.

/**
 * The milliseconds to wait before attempt `attempt + 1`, the first retry being attempt 0: `floor`
 * doubled `attempt` times, at most `ceiling`, and no sooner than `notBefore`, an epoch ms.
 */
export function retryWait(
    attempt: number,
    floor: number,
    ceiling: number,
    notBefore?: number,
): number {
    const step = Math.min(floor * 2 ** attempt, ceiling)
    return notBefore === undefined
        ? step
        : Math.max(step, notBefore - Date.now())
}
