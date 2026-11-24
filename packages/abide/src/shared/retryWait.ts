// 18.33, 46.8, 54.10 — HOW LONG A RETRY WAITS, the one rule every retry abide makes is timed by: the
// browser's outbox and socket mux (`RetryTimer`), the server's `fetchData`, and a `pipe`'s steps (57.10).
// Each passes its own floor and ceiling; what they share is that the wait doubles from the floor,
// stops at the ceiling, and is never sooner than a `Retry-After` the last answer named (15.23) — that
// is the server saying "not before", and a step of our own longer than that is still ours to wait.

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

/** What a `backoff` option takes: the first wait, doubled per retry, or the wait before retry `retry`, from 1. */
export type Backoff = number | ((retry: number) => number)

/**
 * 54.10 — the milliseconds before retry `attempt + 1` under a `backoff` option: `retryWait` from the
 * number given, or from `floor` where none is, or what the function answers for that retry — and in
 * each case no sooner than `notBefore`.
 */
export function backoffWait(
    backoff: Backoff | undefined,
    attempt: number,
    floor: number,
    notBefore?: number,
): number {
    if (typeof backoff !== 'function')
        return retryWait(
            attempt,
            backoff ?? floor,
            Number.POSITIVE_INFINITY,
            notBefore,
        )
    const step = backoff(attempt + 1)
    return notBefore === undefined
        ? step
        : Math.max(step, notBefore - Date.now())
}
