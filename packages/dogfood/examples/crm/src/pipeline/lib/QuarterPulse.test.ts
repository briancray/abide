import { afterAll, beforeEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import QuarterPulse from './QuarterPulse.abide'

// The frames asked for, by id, run when the test says, each handed the time it names.
let queued = new Map<number, FrameRequestCallback>()
let ids = 0
const native = {
    request: globalThis.requestAnimationFrame,
    cancel: globalThis.cancelAnimationFrame,
}
beforeEach(() => {
    queued = new Map()
    globalThis.requestAnimationFrame = (callback) => {
        ids += 1
        queued.set(ids, callback)
        return ids
    }
    globalThis.cancelAnimationFrame = (id) => {
        queued.delete(id)
    }
})
afterAll(() => {
    globalThis.requestAnimationFrame = native.request
    globalThis.cancelAnimationFrame = native.cancel
})
const frame = (time: number) => {
    const due = [...queued.values()]
    queued.clear()
    for (const callback of due) callback(time)
    flushSync()
}
const status = () => document.querySelector('.status')?.textContent
const opacity = () =>
    (document.querySelector('[data-beat]') as HTMLElement).style.opacity

// 51.130, 51.131 — TWO CLOCKS, ONE `playing`: a press plays both, each moving its own `at`.
// THE REVERT: drop `playing` from the beat's options, and Play moves the weeks while the marker
// holds still.
test('one press plays the weeks and the marker together, each at its own length', async () => {
    using _replay = await mount(QuarterPulse({}))
    ;(document.querySelector('button') as HTMLButtonElement).click()
    flushSync()
    frame(0)
    frame(250)
    expect(opacity()).toBe('0.75')
    frame(3500)
    expect(status()).toBe('Week 4: $20,500 won')
    expect(opacity()).toBe('1')
    ;(document.querySelector('button') as HTMLButtonElement).click()
    flushSync()
    expect(queued.size).toBe(0)
})
