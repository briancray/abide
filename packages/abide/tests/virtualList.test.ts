// 51.65-51.71, 51.102-51.104 — THE ITEMS OF A LONG LIST THAT ARE IN VIEW, measured from the markup they
// sit in. The emulator lays nothing out, so the test is the browser: it delivers each resize the shared
// observer would, runs each frame a browser would, and says where the host stands as the view scrolls.
// What a keyed `{#for}` over `shown` renders is the CRM's tests', which mount one.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { flushSync, virtualList } from '#shared'

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
    document.body.replaceChildren()
})

/** Delivers `target`'s size as the shared observer does once the browser has laid it out. */
function laidOut(target: Element, inline: number, block: number): void {
    const entry = {
        target,
        contentRect: { width: inline, height: block },
        borderBoxSize: [{ inlineSize: inline, blockSize: block }],
    } as unknown as ResizeObserverEntry
    for (const callback of heard) callback([entry], {} as ResizeObserver)
    flushSync()
}

/** Runs the frames a browser would, and the work they wake. */
function frame(): void {
    const due = frames.splice(0)
    for (const callback of due) callback(0)
    flushSync()
}

const NUMBERS = Array.from({ length: 1000 }, (_, index) => index)

/** A scroller 300 pixels tall holding the host at its top, the host's gaps set as its CSS would. */
function standing(list: ReturnType<typeof virtualList<number>>) {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    const host = document.createElement('div')
    host.style.columnGap = '20px'
    host.style.rowGap = '10px'
    scroller.append(host)
    document.body.append(scroller)
    Object.defineProperty(scroller, 'clientHeight', { get: () => 300 })
    scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    host.getBoundingClientRect = () => ({ top: -scroller.scrollTop }) as DOMRect
    const went: number[] = []
    scroller.scrollTo = ((to: ScrollToOptions) => {
        went.push(to.top ?? 0)
    }) as typeof scroller.scrollTo
    const stopHost = (
        list.host['bind:element'] as (element: Element) => () => void
    )(host)
    // The items `shown` names, each bound as a keyed `{#for}` would bind it.
    const bound = new Map<number, { element: Element; stop: () => void }>()
    const render = (): void => {
        const wanted = new Set(list.shown.map((entry) => entry.index))
        for (const [index, each] of bound)
            if (!wanted.has(index)) {
                each.stop()
                bound.delete(index)
            }
        for (const entry of list.shown) {
            if (bound.has(entry.index)) continue
            const element = document.createElement('div')
            host.append(element)
            const stop = (
                list.item(entry)['bind:element'] as (
                    element: Element,
                ) => () => void
            )(element)
            bound.set(entry.index, { element, stop })
            // The browser lays a rendered item out, and the observer says so.
            if (measuring) laidOut(element, 100, 50)
        }
    }
    let measuring = false
    const scrolled = (top: number): void => {
        scroller.scrollTop = top
        scroller.dispatchEvent(new Event('scroll'))
        frame()
        render()
    }
    // Laid out: the host 400 wide, each item 100 by 50, as the browser would report them.
    const layOut = (): void => {
        measuring = true
        laidOut(host, 400, 2000)
        render()
        for (const { element } of bound.values()) laidOut(element, 100, 50)
        frame()
        render()
    }
    // Unbound as the page leaving would unbind it, so the shared observer is let go.
    const stop = (): void => {
        for (const each of bound.values()) each.stop()
        bound.clear()
        stopHost()
    }
    return {
        scroller,
        host,
        went,
        render,
        scrolled,
        bound,
        layOut,
        stop,
        stopHost,
    }
}

const indices = (list: ReturnType<typeof virtualList<number>>) =>
    list.shown.map((entry) => entry.index)

// THE REVERT: read the host's size or the scroller as the host is bound, and the bind is a layout read
// — or answer nothing until measured, and the server writes an empty list.
test('the first items render until a measurement, on a server as in a browser — 51.67', () => {
    const list = virtualList({ items: NUMBERS, initial: 10 })
    expect(indices(list)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const { stop } = standing(list)
    expect(indices(list).length).toBe(10)
    stop()
})

// THE REVERT: take one item a row whatever the host's width, and the 400-pixel host lists 9 items in
// view where 27 are due.
test('rows hold what fits across the host and are as tall as the items measured, gaps counted — 51.65, 51.66, 51.68, 51.69', () => {
    const list = virtualList({ items: NUMBERS, initial: 10, overscan: 3 })
    const { host, layOut, render, scrolled, stop } = standing(list)
    layOut()
    // (400 + 20) / (100 + 20) fits 3 a row; a row is 50 + 10 tall; 300 pixels show 6 rows, 3 past.
    expect(indices(list)).toEqual(Array.from({ length: 27 }, (_, at) => at))
    scrolled(600)
    // Row 10 first in view: rows 7 to 19, items 21 to 56.
    expect([list.shown[0]?.index, list.shown.at(-1)?.index]).toEqual([21, 56])
    // 51.69 — the rows left out are the host's block padding.
    expect([host.style.paddingBlockStart, host.style.paddingBlockEnd]).toEqual([
        `${7 * 60}px`,
        `${(334 - 19) * 60}px`,
    ])
    // A narrower host — a breakpoint — fits two a row, with nothing handed in.
    laidOut(host, 250, 2000)
    frame()
    render()
    expect(list.shown[0]?.index).toBe(14)
    stop()
})

// THE REVERT: leave `firstRow` to the scroll event, and the item is not in `shown` until the scroll lands.
test('scrollTo puts the item at the top of the view, and it is shown before the scroll lands — 51.70', () => {
    const list = virtualList({ items: NUMBERS, initial: 10 })
    const { layOut, went, stop } = standing(list)
    layOut()
    list.scrollTo(500)
    flushSync()
    // Row 166 of 3 a row, 60 pixels each.
    expect(went).toEqual([166 * 60])
    expect(indices(list)).toContain(500)
    stop()
})

// THE REVERT: read `current` off the first item rendered rather than the first in view, and the
// overscan above holds it in the section before.
test('sections start where their first item does, the one in view is current, and an empty one is disabled — 51.71, 51.102, 51.103', () => {
    const list = virtualList({
        items: NUMBERS,
        initial: 10,
        section: (n) => String(Math.floor(n / 100)),
        labels: ['0', '1', '2', 'none'],
    })
    const { layOut, scrolled, went, stop } = standing(list)
    layOut()
    const [zero, one, two, none] = list.sections.all as [
        { label: string; index: number },
        { label: string; index: number },
        { label: string; index: number },
        { label: string; index: number },
    ]
    expect([zero, one, two, none]).toEqual([
        { label: '0', index: 0 },
        { label: '1', index: 100 },
        { label: '2', index: 200 },
        { label: 'none', index: -1 },
    ])
    expect(list.sections.current).toBe('0')
    // Row 34, three a row: item 102, in section 1 — the overscan above it still in section 0.
    scrolled(34 * 60)
    expect(list.sections.current).toBe('1')
    expect(list.sections.jump(one)['aria-current']).toBe('true')
    ;(list.sections.jump(two).onclick as () => void)()
    expect(went.at(-1)).toBe(66 * 60)
    expect(list.sections.jump(none).disabled).toBe(true)
    stop()
})

// THE REVERT: keep the host and the scroll listener past the disposer, and a scroll after it moves the
// list.
test('an unbound host follows nothing — 51.104', () => {
    const list = virtualList({ items: NUMBERS, initial: 10 })
    const { layOut, scrolled, stop } = standing(list)
    layOut()
    const before = indices(list)
    stop()
    scrolled(6000)
    expect(indices(list)).toEqual(before)
})
