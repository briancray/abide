import { afterEach, beforeEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import AuditTrail from './AuditTrail.abide'

// The emulator lays nothing out, so the test is the browser: it reports each size the shared resize
// observer would, and runs each frame a browser would.
const heard: ResizeObserverCallback[] = []
const frames: FrameRequestCallback[] = []
const ORIGINAL = {
    observer: globalThis.ResizeObserver,
    frame: globalThis.requestAnimationFrame,
}
beforeEach(() => {
    heard.length = 0
    frames.length = 0
    globalThis.ResizeObserver = class {
        constructor(callback: ResizeObserverCallback) {
            heard.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    globalThis.requestAnimationFrame = (callback) => {
        frames.push(callback)
        return frames.length
    }
})
afterEach(() => {
    globalThis.ResizeObserver = ORIGINAL.observer
    globalThis.requestAnimationFrame = ORIGINAL.frame
})

const list = () => document.querySelector('[role=list]') as HTMLElement
const scroller = () => list().parentElement as HTMLElement
const rows = () => [...document.querySelectorAll('[role=listitem]')]
const positions = () =>
    rows().map((row) => Number(row.getAttribute('aria-posinset')))

function report(target: Element, width: number, height: number): void {
    const entry = {
        target,
        contentRect: { width, height },
        borderBoxSize: [{ inlineSize: width, blockSize: height }],
    } as unknown as ResizeObserverEntry
    for (const callback of heard) callback([entry], {} as ResizeObserver)
}

// The browser's work for a frame: every row laid out at 28 pixels, then the frame's callbacks.
function frame(): void {
    for (const row of rows()) report(row, 600, 28)
    flushSync()
    for (const callback of frames.splice(0)) callback(0)
    flushSync()
}

// A scroller 320 pixels tall, the list at its top, laid out once.
function laidOut(): void {
    Object.defineProperty(scroller(), 'clientHeight', { get: () => 320 })
    scroller().style.overflowY = 'auto'
    scroller().getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    list().getBoundingClientRect = () =>
        ({ top: -scroller().scrollTop }) as DOMRect
    report(list(), 600, 0)
    frame()
}

function scrollTo(top: number) {
    scroller().scrollTop = top
    scroller().dispatchEvent(new Event('scroll'))
    frame()
}

// 51.65, 51.67 — THE FIRST ROWS UNTIL IT IS MEASURED, THEN ONLY THE ROWS IN VIEW AND THREE PAST, each
// saying where it stands in the whole trail. THE REVERT: render `AUDIT_TRAIL` whole, and 5,000 rows are
// made where 20 are due.
test('only the changes in view, and three past, are rows', async () => {
    using _trail = await mount(AuditTrail({}))
    expect(positions()).toEqual(Array.from({ length: 20 }, (_, at) => at + 1))
    expect(rows()[0]?.getAttribute('aria-setsize')).toBe('5000')
    laidOut()
    // 320 pixels at 28 a row show 13, and three more below.
    expect(positions()).toEqual(Array.from({ length: 16 }, (_, at) => at + 1))
    scrollTo(100 * 28)
    expect(positions()[0]).toBe(98)
    expect(positions().at(-1)).toBe(116)
})

// 51.65, 51.69 — A SCROLL BY ONE ROW MAKES ONE ROW AND KEEPS THE REST, and a scroll inside a row writes
// nothing. THE REVERT: drop `by entry.key`, and every row is rewritten in place where one is made.
test('scrolling by a row makes the row coming into view and keeps the others', async () => {
    using _trail = await mount(AuditTrail({}))
    laidOut()
    scrollTo(100 * 28)
    const kept = new Set(rows())
    const inside = measure(() => scrollTo(100 * 28 + 10))
    atMost(inside, { nodesCreated: 0, styleWrites: 0, dataWrites: 0 })
    const byOne = measure(() => scrollTo(101 * 28))
    // One row — its element, two spans and their texts — and the list's two paddings.
    atMost(byOne, { nodesCreated: 6, styleWrites: 2 })
    const same = rows().filter((row) => kept.has(row))
    expect(same.length).toBe(rows().length - 1)
})
