import { afterAll, beforeEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageMarker from './StageMarker.abide'

// The emulator lays nothing out: each element's top is answered here, the board scrolled 300px up
// the viewport and each stage 40px below the one before. Frames run when the test says.
let scrolled = 0
let queued: FrameRequestCallback[] = []
const native = {
    request: globalThis.requestAnimationFrame,
    rect: Element.prototype.getBoundingClientRect,
}
beforeEach(() => {
    queued = []
    globalThis.requestAnimationFrame = (callback) => queued.push(callback)
    Element.prototype.getBoundingClientRect = function (this: Element) {
        const stages = [...(this.parentElement?.children ?? [])]
        const top =
            this.tagName === 'LI'
                ? 100 - scrolled + stages.indexOf(this) * 40
                : 100 - scrolled
        return {
            x: 0,
            y: top,
            top,
            left: 0,
            right: 200,
            bottom: top + 40,
            width: 200,
            height: 40,
        } as DOMRect
    }
})
afterAll(() => {
    globalThis.requestAnimationFrame = native.request
    Element.prototype.getBoundingClientRect = native.rect
})
const frame = () => {
    const due = queued
    queued = []
    for (const callback of due) callback(0)
    flushSync()
}
const status = () => document.querySelector('.status')?.textContent

// 32.84, 32.110 — TWO RECTANGLES, SUBTRACTED: each is in the viewport, so the difference is where
// one sits inside the other, the same however far the page has scrolled.
// THE REVERT: show `current.top` alone, and the marker moves with every scroll.
test("the deal's stage is measured from the top of the board, not the viewport", async () => {
    using _marker = await mount(StageMarker({}))
    frame()
    expect(status()).toBe('80px down the board')
    scrolled = 300
    window.dispatchEvent(new Event('scroll'))
    frame()
    expect(status()).toBe('80px down the board')
    expect(
        (document.querySelector('[data-marker]') as HTMLElement).style.top,
    ).toBe('80px')
})
