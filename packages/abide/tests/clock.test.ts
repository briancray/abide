import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test'

import { follow, nextChange } from '#shared/clock.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// The timers the clock sets, as a fake records them: what stands is set and not yet cleared.
type Pending = { wait: number; cleared: boolean }
let timers: Pending[] = []
const realSet = globalThis.setTimeout
const realClear = globalThis.clearTimeout
const standing = () => timers.filter((timer) => !timer.cleared)

beforeEach(() => {
    setSystemTime(new Date('2026-11-20T12:00:00Z'))
    timers = []
    globalThis.setTimeout = ((_: () => void, wait: number) => {
        const timer = { wait, cleared: false }
        timers.push(timer)
        return timer
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((timer: Pending | undefined) => {
        if (timer !== undefined) timer.cleared = true
    }) as unknown as typeof clearTimeout
})

afterEach(() => {
    globalThis.setTimeout = realSet
    globalThis.clearTimeout = realClear
    setSystemTime()
    Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
    })
})

// 52.74 — A LABEL WAITS UNTIL IT NEXT READS DIFFERENTLY: half a unit past where its count stands,
// or where the unit itself turns. THE REVERT: wait a whole unit from now — "5 minutes ago" waits 60s
// where it turns to 6 at 5½.
test('a label waits until format.relative next writes it differently — 52.74', () => {
    const now = Date.now()
    // `now` until a minute has passed, either side.
    expect(nextChange(now - 20_000, now)).toBe(40_000)
    expect(nextChange(now + 20_000, now)).toBe(80_000)
    // 5 minutes ago turns to 6 at 5½.
    expect(nextChange(now - 5 * MINUTE, now)).toBe(MINUTE / 2)
    // 3 hours ago turns to 4 at 3½.
    expect(nextChange(now - 3 * HOUR, now)).toBe(HOUR / 2)
    // 59.6 minutes ago reads "60 minutes ago" until the hour, where it reads "1 hour ago".
    expect(nextChange(now - 59.6 * MINUTE, now)).toBe(0.4 * MINUTE)
    // In 2 days turns to "tomorrow" at 1½ days away.
    expect(nextChange(now + 2 * DAY, now)).toBe(DAY / 2)
    // In 61 minutes reads "in 1 hour" until under the hour, where it reads minutes.
    expect(nextChange(now + 61 * MINUTE, now)).toBe(MINUTE + 1)
})

// 52.73 — ONE TIMER FOR EVERY TIME FOLLOWED, set for the soonest change, and none once nothing is.
// THE REVERT: drop the clear in `schedule` — three follows leave three timers standing.
test('one timer stands for every time followed, at the soonest change — 52.73', () => {
    const now = Date.now()
    const leave = [
        follow(now - 3 * HOUR),
        follow(now - 5 * MINUTE),
        follow(now - 2 * DAY),
    ]
    expect(standing()).toHaveLength(1)
    expect(standing()[0]?.wait).toBe(MINUTE / 2)
    // The soonest one gone, the next soonest is waited for.
    leave[1]?.()
    expect(standing()).toHaveLength(1)
    expect(standing()[0]?.wait).toBe(HOUR / 2)
    for (const each of leave) each()
    expect(standing()).toHaveLength(0)
})

// 52.75 — A HIDDEN PAGE SETS NO TIMER, and shown again it schedules at once. THE REVERT: drop the
// visibility check — a timer stands while the page is hidden.
test('a hidden page sets no timer, and schedules again once shown — 52.75', () => {
    Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
    })
    const leave = follow(Date.now() - 5 * MINUTE)
    expect(standing()).toHaveLength(0)
    Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(standing()).toHaveLength(1)
    leave()
    // Nothing followed, the page's visibility is no longer listened to.
    Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(standing()).toHaveLength(0)
})
