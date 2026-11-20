// 51.65-51.70 — THE ROWS OF A LONG LIST THAT ARE IN VIEW: the range `virtualRows` answers as its
// viewport scrolls and is measured. What a keyed `{#for}` over that range renders is the CRM's
// tests', which mount one (`ops/lib/AuditTrail.test.ts`).

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { flushSync, virtualRows, watch } from '#shared'

// A `ResizeObserver` that hands its callbacks to the test, which delivers an entry as a browser does
// once the viewport is laid out.
const heard: ResizeObserverCallback[] = []
const ORIGINAL = globalThis.ResizeObserver
beforeEach(() => {
    heard.length = 0
    globalThis.ResizeObserver = class {
        constructor(callback: ResizeObserverCallback) {
            heard.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
    }
})
afterEach(() => {
    globalThis.ResizeObserver = ORIGINAL
})

function laidOut(element: Element, height: number): void {
    const entry = {
        target: element,
        contentRect: { height },
    } as unknown as ResizeObserverEntry
    for (const callback of heard) callback([entry], {} as ResizeObserver)
    flushSync()
}

function scrolled(element: HTMLElement, top: number): void {
    element.scrollTop = top
    element.dispatchEvent(new Event('scroll'))
    flushSync()
}

const rangeOf = (view: ReturnType<typeof virtualRows>) => [
    view.start(),
    view.end(),
    view.before(),
    view.after(),
]

// THE REVERT: drop the overscan from `start`, and the first range reads 100 where 95 is due.
test('the range is the rows in view and the overscan past each end, clamped into the list — 51.65, 51.66', () => {
    const view = virtualRows({ count: () => 1000, rowHeight: 20, height: 200 })
    expect(rangeOf(view)).toEqual([0, 15, 0, 985 * 20])
    const viewport = document.createElement('div')
    document.body.append(viewport)
    const stop = view.viewport(viewport)
    scrolled(viewport, 2000)
    expect(rangeOf(view)).toEqual([95, 115, 95 * 20, 885 * 20])
    scrolled(viewport, 999 * 20)
    expect(view.end()).toBe(1000)
    expect(view.after()).toBe(0)
    stop()
    viewport.remove()
    const short = virtualRows({ count: () => 3, rowHeight: 20, height: 200 })
    expect(rangeOf(short)).toEqual([0, 3, 0, 0])
})

// THE REVERT: write the first row in view unfloored, and a scroll inside one row wakes both ends.
test('a scroll inside one row wakes nothing, and one by a row moves the range by one — 51.68', () => {
    const view = virtualRows({ count: () => 1000, rowHeight: 20, height: 200 })
    const viewport = document.createElement('div')
    document.body.append(viewport)
    const stop = view.viewport(viewport)
    scrolled(viewport, 2000)
    const runs = { start: 0, end: 0 }
    const stopStart = watch(() => {
        view.start()
        runs.start += 1
    })
    const stopEnd = watch(() => {
        view.end()
        runs.end += 1
    })
    flushSync()
    scrolled(viewport, 2005)
    scrolled(viewport, 2019)
    expect(runs).toEqual({ start: 1, end: 1 })
    scrolled(viewport, 2020)
    expect(runs).toEqual({ start: 2, end: 2 })
    expect([view.start(), view.end()]).toEqual([96, 116])
    stopStart()
    stopEnd()
    stop()
    viewport.remove()
})

// THE REVERT: read `scrollTop` as the viewport is bound, and the bind is a layout read.
test("the viewport's height and a restored scroll are read once it is laid out, not as it is bound — 51.67", () => {
    const view = virtualRows({ count: () => 1000, rowHeight: 20, height: 200 })
    const viewport = document.createElement('div')
    document.body.append(viewport)
    viewport.scrollTop = 600
    let reads = 0
    const own = Object.getOwnPropertyDescriptor(
        Element.prototype,
        'scrollTop',
    ) as PropertyDescriptor
    Object.defineProperty(viewport, 'scrollTop', {
        configurable: true,
        get() {
            reads += 1
            return own.get?.call(this)
        },
        set(value) {
            own.set?.call(this, value)
        },
    })
    const stop = view.viewport(viewport)
    expect(reads).toBe(0)
    expect(rangeOf(view)).toEqual([0, 15, 0, 985 * 20])
    laidOut(viewport, 400)
    // Row 30 first in view, 20 rows fit, 5 past each end.
    expect([view.start(), view.end()]).toEqual([25, 55])
    stop()
    viewport.remove()
})

// THE REVERT: leave `follow` out of `scrollTo`, and the row is not in the range until the scroll
// event lands.
test('scrollTo scrolls only as far as shows the row, which is in the range at once — 51.70', () => {
    const view = virtualRows({ count: () => 1000, rowHeight: 20, height: 200 })
    const viewport = document.createElement('div')
    document.body.append(viewport)
    const stop = view.viewport(viewport)
    view.scrollTo(50)
    flushSync()
    // Its bottom at the bottom of the view: 51 rows down, less the 200 pixels the view shows.
    expect(viewport.scrollTop).toBe(51 * 20 - 200)
    expect(view.start() <= 50 && 50 < view.end()).toBe(true)
    view.scrollTo(45)
    expect(viewport.scrollTop).toBe(51 * 20 - 200)
    view.scrollTo(10)
    flushSync()
    expect(viewport.scrollTop).toBe(200)
    expect(view.start()).toBe(5)
    stop()
    viewport.remove()
})

// THE REVERT: keep the scroll listener past the disposer, and a scroll after it moves the range.
test('an unbound viewport is no longer followed — 51.69', () => {
    const view = virtualRows({ count: () => 1000, rowHeight: 20, height: 200 })
    const viewport = document.createElement('div')
    document.body.append(viewport)
    const stop = view.viewport(viewport)
    stop()
    scrolled(viewport, 2000)
    expect(view.start()).toBe(0)
    viewport.remove()
})
