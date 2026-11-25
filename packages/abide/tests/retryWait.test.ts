// 18.33, 46.8, 54.10 — EVERY RETRY IS TIMED BY ONE RULE: the browser's `RetryTimer` (the outbox and the
// socket mux) and the server's `fetchData` wait what `retryWait` says — the floor doubled per retry,
// and never sooner than a `Retry-After`. Neither test waits: the timer and the sleep are recorded.

import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'

import { fetchData } from '#server'
import { retryWait } from '#shared/retryWait.ts'
import { RetryTimer } from '#ui/RetryTimer.ts'

/** `fetchData`'s answer, or the refusal it rejected with (54.16), as one value a test reads. */
const settledFetch = ((...given: Parameters<typeof fetchData>) =>
    fetchData(...given).catch((refusal: unknown) => refusal)) as unknown as (
    ...given: Parameters<typeof fetchData>
) => Promise<any>

const service = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
        const { pathname } = new URL(request.url)
        if (pathname === '/soon')
            return new Response('later', {
                status: 429,
                headers: { 'retry-after': '0' },
            })
        return new Response('busy', { status: 503 })
    },
})
afterAll(() => service.stop(true))

const spies: { mockRestore(): void }[] = []
afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore()
})

/** The waits `fetchData` sleeps between attempts, slept as nothing. */
function sleptBy(): number[] {
    const slept: number[] = []
    const spy = spyOn(Bun, 'sleep').mockImplementation(((wait: number) => {
        slept.push(wait)
        return Promise.resolve()
    }) as typeof Bun.sleep)
    spies.push(spy)
    return slept
}

/** The waits a `RetryTimer` arms, armed as nothing. */
function armedBy(): number[] {
    const armed: number[] = []
    const spy = spyOn(globalThis, 'setTimeout').mockImplementation(((
        _run: () => void,
        wait: number,
    ) => {
        armed.push(wait)
        return 0
    }) as unknown as typeof setTimeout)
    spies.push(spy)
    return armed
}

test('the floor doubles per retry, stops at the ceiling, and waits out a later Retry-After', () => {
    expect(
        [0, 1, 2, 3].map((attempt) => retryWait(attempt, 250, 1_000)),
    ).toEqual([250, 500, 1_000, 1_000])
    expect(retryWait(0, 250, 1_000, Date.now() - 5_000)).toBe(250)
    expect(retryWait(0, 250, 1_000, Date.now() + 5_000)).toBeGreaterThan(4_900)
})

// THE REVERT: give `fetchData` back its own `FIRST_BACKOFF * 2 ** attempt`, tripled, or `RetryTimer`
// its own doubling with the floor tripled — the two sequences part.
test('fetchData and RetryTimer wait the same sequence from the same floor — 54.10, 46.8', async () => {
    const slept = sleptBy()
    await settledFetch(`${service.url.origin}/down`, {
        retries: 3,
        timeout: 5_000,
    })
    const backoff = new RetryTimer(250, Number.POSITIVE_INFINITY, () => {})
    const armed = armedBy()
    for (let retry = 0; retry < 3; retry += 1) backoff.later()
    expect(slept).toEqual([250, 500, 1_000])
    expect(armed).toEqual(slept)
})

// THE REVERT: wait the `Retry-After` in place of the step, as `fetchData` did — `0` is slept where
// 250 is due, while `RetryTimer` arms 250 for the same answer.
test('a Retry-After sooner than the step waits the step, in both — 54.10', async () => {
    const slept = sleptBy()
    await settledFetch(`${service.url.origin}/soon`, {
        retries: 1,
        timeout: 5_000,
    })
    const backoff = new RetryTimer(250, 10_000, () => {})
    const armed = armedBy()
    backoff.later(Date.now())
    expect(slept).toEqual([250])
    expect(armed).toEqual([250])
})

// 54.10 — `backoff` IS THE FLOOR THE RULE DOUBLES, OR THE WAIT ITSELF: a number moves where the
// doubling starts, and a function is asked for each retry by its number from 1. THE REVERT: drop
// `backoff` from `fetchData`'s `backoffWait` call, and `[250, 500, 1000]` is slept both times.
test('backoff moves the floor, or names each wait — 54.10', async () => {
    const slept = sleptBy()
    await settledFetch(`${service.url.origin}/down`, {
        retries: 3,
        timeout: 50_000,
        backoff: 1_000,
    })
    expect(slept).toEqual([1_000, 2_000, 4_000])
    slept.length = 0
    await settledFetch(`${service.url.origin}/down`, {
        retries: 3,
        timeout: 50_000,
        backoff: (retry) => retry ** 2 * 100,
    })
    expect(slept).toEqual([100, 400, 900])
})
