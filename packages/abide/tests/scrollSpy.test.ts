// 51.169-51.177 — THE SECTION OF A LONG PAGE THE READER IS AT. The emulator lays nothing out, so the test
// is the browser: each section's element says where it stands in a scroller 300 pixels tall and 2000
// pixels long, the shared observer delivers what a resize would, and each frame runs as a browser runs it.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { flushSync, scrollSpy } from '#shared'

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
// Every host bound, unbound after its test, failed or not, so the shared observer is let go.
const bound: (() => void)[] = []
afterEach(() => {
    for (const unbind of bound.splice(0)) unbind()
    globalThis.ResizeObserver = ORIGINAL.observer
    globalThis.requestAnimationFrame = ORIGINAL.frame
    document.body.replaceChildren()
    history.replaceState(history.state, '', location.pathname)
})

/** Runs the frames a browser would, and the work they wake. */
function frame(): void {
    const due = frames.splice(0)
    for (const callback of due) callback(0)
    flushSync()
}

// Layout reads a scroll could make, counted.
let reads = 0

/**
 * A scroller holding a section per `tops` entry, each standing that many pixels down it, with its
 * host bound; `margin` and `padding` are the sections' scroll margin and the scroller's scroll padding.
 */
function standing(
    tops: Record<string, number>,
    { margin = 0, padding = 0, scrub = false } = {},
) {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    scroller.style.scrollPaddingTop = `${padding}px`
    document.body.append(scroller)
    Object.defineProperty(scroller, 'clientHeight', { get: () => 300 })
    Object.defineProperty(scroller, 'scrollHeight', { get: () => 2000 })
    scroller.getBoundingClientRect = () => {
        reads += 1
        return { top: 0 } as DOMRect
    }
    const went: ScrollToOptions[] = []
    scroller.scrollTo = ((to: ScrollToOptions) => {
        went.push(to)
    }) as typeof scroller.scrollTo
    const article = document.createElement('article')
    scroller.append(article)
    for (const [key, top] of Object.entries(tops)) {
        const section = document.createElement('h2')
        section.id = key
        section.style.scrollMarginTop = `${margin}px`
        section.getBoundingClientRect = () => {
            reads += 1
            return { top: (tops[key] ?? top) - scroller.scrollTop } as DOMRect
        }
        article.append(section)
    }
    const spy = scrollSpy({ items: () => Object.keys(tops), scrub })
    const nav = document.createElement('nav')
    document.body.append(nav)
    const unbind = (
        spy.host['bind:element'] as (element: Element) => () => void
    )(nav)
    bound.push(unbind)
    const scrolled = (top: number): void => {
        scroller.scrollTop = top
        scroller.dispatchEvent(new Event('scroll'))
        frame()
    }
    /** The shared observer telling every listener an element resized. */
    const resized = (): void => {
        for (const callback of heard)
            callback(
                [{ target: article } as unknown as ResizeObserverEntry],
                {} as ResizeObserver,
            )
        frame()
    }
    return { scroller, article, nav, spy, went, scrolled, resized, unbind }
}

// THE REVERT: answer `undefined` until a section crosses the line — the band an IntersectionObserver
// draws — and nothing is current at the top of a page whose first heading sits below an intro.
test('the first section is current at the very top, before and after measuring — 51.169', () => {
    const { spy, scrolled, unbind } = standing({
        intro: 200,
        pricing: 600,
        terms: 1000,
    })
    expect(spy.current).toBe('intro')
    frame()
    scrolled(0)
    expect(spy.current).toBe('intro')
    unbind()
})

// THE REVERT: compare the section's bare top with the scroll — drop the margin and the padding — and at
// 549 pixels the section a jump would land at 550 is current a pixel early; at 550 it is still not.
test('a section is current once the scroll reaches where a link lands it, margin and padding counted — 51.169', () => {
    const { spy, scrolled, unbind } = standing(
        { intro: 0, pricing: 600, terms: 1000 },
        { margin: 10, padding: 40 },
    )
    frame()
    scrolled(549)
    expect(spy.current).toBe('intro')
    scrolled(550)
    expect(spy.current).toBe('pricing')
    unbind()
})

// THE REVERT: leave the end to the landings, and at the end of the scroller the section above the last
// stays current — the last starts at 1900 and the scroller can only reach 1700.
test('the last section is current at the end of the scroller though it never reaches the line, a short one before it skipped — 51.170', () => {
    const { spy, scrolled, unbind } = standing({
        intro: 0,
        pricing: 1500,
        notes: 1600,
        terms: 1900,
    })
    frame()
    scrolled(1650)
    expect(spy.current).toBe('notes')
    scrolled(1700)
    expect(spy.current).toBe('terms')
    unbind()
})

// THE REVERT: measure in `update`, as an offset read per frame, and a burst of 20 scrolls reads 80
// boxes.
test('a scroll reads no layout, only the scroll position — 51.172', () => {
    const { spy, scrolled, unbind } = standing({
        intro: 0,
        pricing: 600,
        terms: 1000,
    })
    reads = 0
    frame()
    // Measuring reads every section's box, so the count below is not vacuous.
    expect(reads).toBeGreaterThan(0)
    reads = 0
    for (let top = 0; top <= 1000; top += 50) scrolled(top)
    expect(reads).toBe(0)
    expect(spy.current).toBe('terms')
    unbind()
})

// THE REVERT: measure only once, as the host is bound, and a part streaming in above `terms` leaves
// `terms` current where the reader is still in `pricing`.
test('an element holding a section resizing measures again — 51.173', () => {
    const tops = { intro: 0, pricing: 600, terms: 1000 }
    const { spy, scrolled, resized, unbind } = standing(tops)
    frame()
    scrolled(1100)
    expect(spy.current).toBe('terms')
    tops.terms = 1400
    resized()
    expect(spy.current).toBe('pricing')
    unbind()
})

// THE REVERT: drop `preventDefault` and the scroll, and a click is the browser's jump — no `behavior`,
// and the jump never lands past the sticky header the padding names.
test('a jump links to its section, and a plain click scrolls to where the link lands it — 51.174, 51.175, 51.176', () => {
    const { spy, went, unbind } = standing(
        { intro: 0, pricing: 600, terms: 1000 },
        { margin: 10, padding: 40 },
    )
    frame()
    const jump = spy.jump('pricing')
    expect(jump.href).toBe('#pricing')
    const plain = new MouseEvent('click', { button: 0, cancelable: true })
    ;(jump.onclick as (event: MouseEvent) => void)(plain)
    expect(plain.defaultPrevented).toBe(true)
    expect(went).toEqual([{ top: 550, behavior: 'auto' }])
    expect(location.hash).toBe('#pricing')
    // A click with ⌘ held opens a tab: the browser's.
    const modified = new MouseEvent('click', {
        button: 0,
        metaKey: true,
        cancelable: true,
    })
    ;(jump.onclick as (event: MouseEvent) => void)(modified)
    expect(modified.defaultPrevented).toBe(false)
    // A section the document does not hold: the browser's too.
    const missing = new MouseEvent('click', { button: 0, cancelable: true })
    ;(spy.jump('appendix').onclick as (event: MouseEvent) => void)(missing)
    expect(missing.defaultPrevented).toBe(false)
    expect(went.length).toBe(1)
    unbind()
})

// THE REVERT: keep the scroll listener past the disposer, and each scroll after it still asks for a
// frame — the answer stays right, the work does not stop.
test('an unbound host follows nothing — 51.177', () => {
    const { spy, scroller, unbind } = standing({
        intro: 0,
        pricing: 600,
        terms: 1000,
    })
    frame()
    unbind()
    scroller.scrollTop = 1100
    scroller.dispatchEvent(new Event('scroll'))
    expect(frames.length).toBe(0)
    frame()
    expect(spy.current).toBe('intro')
})

// THE REVERT: answer the document's root where no ancestor scrolls, rather than the window, and the
// page's own scroll is never heard.
test('the window is the scroller where no ancestor of the first section scrolls — 51.171', () => {
    const article = document.createElement('article')
    document.body.append(article)
    for (const [key, top] of [
        ['intro', 0],
        ['terms', 800],
    ] as const) {
        const section = document.createElement('h2')
        section.id = key
        section.getBoundingClientRect = () =>
            ({ top: top - window.scrollY }) as DOMRect
        article.append(section)
    }
    const spy = scrollSpy({ items: ['intro', 'terms'] })
    const unbind = (
        spy.host['bind:element'] as (element: Element) => () => void
    )(document.createElement('nav'))
    bound.push(unbind)
    frame()
    window.scrollTo(0, 900)
    window.dispatchEvent(new Event('scroll'))
    frame()
    expect(spy.current).toBe('terms')
    unbind()
    window.scrollTo(0, 0)
})
