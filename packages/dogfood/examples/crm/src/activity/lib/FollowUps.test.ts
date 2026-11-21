import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import FollowUps from './FollowUps.abide'

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
    [...document.querySelectorAll('li')].map((line) =>
        line.querySelector('strong')?.textContent?.trim(),
    )

// 52.73 — A LIST WRITES ITS OWN `<time>` PER ROW from one set of parts: the label, a machine's
// `datetime` and the date in full as `title`.
test('each follow-up reads how soon it is due, on a time of its own', async () => {
    using _due = await mount(FollowUps({}))
    expect(said()).toEqual(['in 2 days', 'in 5 days'])
    const time = document.querySelector('time')
    expect(time?.getAttribute('datetime')).toBe('2026-11-20T15:04:00.000Z')
    expect(time?.getAttribute('title')).toBe('Nov 20, 2026, 3:04 PM')
})

// 52.74 — A TIME IS FOLLOWED WHILE ITS ELEMENT IS BOUND: two rows, one timer; both marked done, none.
// THE REVERT: drop the disposer the `time` part's `bind:element` hands back — a timer stands for rows
// that are gone.
test('the clock follows a row while it stands, and stops with the last', async () => {
    using _due = await mount(FollowUps({}))
    expect(standing()).toHaveLength(1)
    for (const button of [...document.querySelectorAll('button')]) {
        ;(button as HTMLButtonElement).click()
        flushSync()
    }
    expect(said()).toEqual([])
    expect(standing()).toHaveLength(0)
})
