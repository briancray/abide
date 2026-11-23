import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import LastTouched from './LastTouched.abide'

const MINUTE = 60_000

// The clock's timers, held rather than run, so a test moves time and fires what is due.
type Pending = { run: () => void; wait: number; cleared: boolean }
let timers: Pending[] = []
const realSet = globalThis.setTimeout
const realClear = globalThis.clearTimeout
const standing = () => timers.filter((timer) => !timer.cleared)

beforeEach(() => {
    setSystemTime(new Date('2026-11-18T15:04:00Z'))
    timers = []
    globalThis.setTimeout = ((run: () => void, wait: number) => {
        const timer = { run, wait, cleared: false }
        timers.push(timer)
        return timer
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((timer: Pending | undefined) => {
        if (timer !== undefined && typeof timer === 'object')
            timer.cleared = true
    }) as unknown as typeof clearTimeout
})

afterEach(() => {
    globalThis.setTimeout = realSet
    globalThis.clearTimeout = realClear
    setSystemTime()
})

const said = () =>
    [...document.querySelectorAll('strong')].map((line) =>
        line.textContent?.replace(/\s+/g, ' ').trim(),
    )

/** Moves the system clock on, and fires the clock's one timer as the browser would. */
function pass(milliseconds: number) {
    setSystemTime(new Date(Date.now() + milliseconds))
    const due = standing()
    for (const timer of due) {
        timer.cleared = true
        timer.run()
    }
    flushSync()
}

// 52.72 — A TIME READS HOW LONG AGO IT WAS, in a `<time>` a machine reads and a title with the date.
test('a touch reads how long ago it was, and a new call now', async () => {
    using _touched = await mount(LastTouched({}))
    expect(said()).toEqual([
        'Ada Lovelace, 3 hours ago',
        'Grace Hopper, yesterday',
    ])
    const time = document.querySelector('time')
    expect(time?.getAttribute('datetime')).toBe('2026-11-18T12:04:00.000Z')
    expect(time?.getAttribute('title')).toBe('Nov 18, 2026, 12:04 PM')
    const work = measure(() => {
        document.querySelector('button')?.click()
        flushSync()
    })
    expect(said()).toEqual([
        'Katherine Johnson, now',
        'Ada Lovelace, 3 hours ago',
        'Grace Hopper, yesterday',
    ])
    // The new row alone: the two already there say what they said.
    atMost(work, { dataWrites: 1 })
})

// 52.73, 52.76 — ONE CLOCK TICKS EVERY TIME, when the soonest label turns, and a tick writes only
// the labels that turned. THE REVERT: read `Date.now()` in the label rather than the clock — the
// labels never move.
test('one clock moves every label, writing only those that turned', async () => {
    using _touched = await mount(LastTouched({}))
    document.querySelector('button')?.click()
    flushSync()
    // Three times standing, one timer: Katherine's "now" turns first, a minute on.
    expect(standing()).toHaveLength(1)
    expect(standing()[0]?.wait).toBe(MINUTE)
    let work = measure(() => pass(MINUTE))
    expect(said()).toEqual([
        'Katherine Johnson, 1 minute ago',
        'Ada Lovelace, 3 hours ago',
        'Grace Hopper, yesterday',
    ])
    atMost(work, { dataWrites: 1 })
    // Half an hour on, Ada's three hours turn to four.
    work = measure(() => pass(30 * MINUTE))
    expect(said()).toEqual([
        'Katherine Johnson, 31 minutes ago',
        'Ada Lovelace, 4 hours ago',
        'Grace Hopper, yesterday',
    ])
    expect(standing()).toHaveLength(1)
})
