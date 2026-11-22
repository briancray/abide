// 32.101-32.108 — A SCROLLING ELEMENT MARKED WITH THE EDGES IT CAN STILL SCROLL TOWARD, as
// `data-scrollable`. The hand-written version reads the scroll position in the scroll listener — a
// forced layout per event — and watches the element's own size, which never moves as content grows
// inside it.
//
// THE WORK IS COUNTED, NOT TIMED: frames asked for, geometry read, attributes written, and what the
// shared resize observer watches. The emulator lays nothing out, so each element's scroll geometry
// is answered here and frames run when a test says so. Whether a real browser's scroll lands on the
// right edges, right to left among them, is `e2e/scrollEdges.spec.ts`'s.

import { afterEach, beforeEach, expect, test } from 'bun:test'

import { scrollEdges } from '#shared/scrollEdges.ts'

// The shared resize observer is made by the first bind (32.98), so the stand-in is installed at load.
type Delivery = (entries: { target: Element }[]) => void
const resize = {
    observed: new Set<Element>(),
    deliver: undefined as Delivery | undefined,
}
class ResizeStandIn {
    constructor(deliver: Delivery) {
        resize.deliver = deliver
    }
    observe(element: Element): void {
        resize.observed.add(element)
    }
    unobserve(element: Element): void {
        resize.observed.delete(element)
    }
    disconnect(): void {
        resize.observed.clear()
    }
}
Object.assign(globalThis, { ResizeObserver: ResizeStandIn })

const counts = { frames: 0, reads: 0, log: '' }
let queued: FrameRequestCallback[] = []
const native = {
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    setAttribute: Element.prototype.setAttribute,
    removeAttribute: Element.prototype.removeAttribute,
}

beforeEach(() => {
    counts.frames = 0
    counts.reads = 0
    counts.log = ''
    queued = []
    globalThis.requestAnimationFrame = (callback) => {
        counts.frames += 1
        queued.push(callback)
        return queued.length
    }
    globalThis.cancelAnimationFrame = () => {
        queued = []
    }
    Element.prototype.setAttribute = function (name: string, value: string) {
        if (name === 'data-scrollable') counts.log += 'w'
        native.setAttribute.call(this, name, value)
    }
    Element.prototype.removeAttribute = function (name: string) {
        if (name === 'data-scrollable') counts.log += 'w'
        native.removeAttribute.call(this, name)
    }
})

const stops: (() => void)[] = []
// A frame asked for and never run would leave the next test's binds waiting on it.
afterEach(() => {
    runFrame()
    for (const stop of stops.splice(0)) stop()
    document.body.replaceChildren()
    Object.assign(globalThis, {
        requestAnimationFrame: native.requestAnimationFrame,
        cancelAnimationFrame: native.cancelAnimationFrame,
    })
    Element.prototype.setAttribute = native.setAttribute
    Element.prototype.removeAttribute = native.removeAttribute
})

function runFrame(): void {
    const callbacks = queued
    queued = []
    for (const callback of callbacks) callback(0)
}

/**
 * A scroller 100px square whose content is `width` by `height`, scrolled to `top` and `left`, a
 * read of `scrollTop` counted as the read of the element.
 */
function scroller(
    geometry = { top: 0, left: 0, width: 100, height: 300 },
    parent: Element = document.body,
) {
    const element = document.createElement('div')
    parent.append(element)
    const define = (name: string, get: () => number) =>
        Object.defineProperty(element, name, { get, configurable: true })
    define('scrollTop', () => {
        counts.reads += 1
        counts.log += 'r'
        return geometry.top
    })
    define('scrollLeft', () => geometry.left)
    define('scrollHeight', () => geometry.height)
    define('scrollWidth', () => geometry.width)
    define('clientHeight', () => 100)
    define('clientWidth', () => 100)
    const stop = scrollEdges(element)
    stops.push(stop)
    return { element, geometry, stop }
}

// 32.101, 32.102 — EACH EDGE CONTENT LIES BEYOND, IN ONE ORDER, and a horizontal scroll position
// measured from the start whichever side the start is: a right-to-left scroller's runs from zero
// down to the negative of its overflow. THE REVERT: read `scrollLeft` signed in `measure`; the
// right-to-left scroller scrolled to its middle reads `bottom end`, its `start` lost.
test('the edges content lies beyond are written as data-scrollable, start and end from the scroll origin — 32.101, 32.102', () => {
    const { element, geometry } = scroller()
    runFrame()
    expect(element.getAttribute('data-scrollable')).toBe('bottom')
    const reading = (top: number, left: number, width: number) => {
        geometry.top = top
        geometry.left = left
        geometry.width = width
        element.dispatchEvent(new Event('scroll'))
        runFrame()
        return element.getAttribute('data-scrollable')
    }
    expect(reading(100, 0, 100)).toBe('top bottom')
    expect(reading(200, 0, 300)).toBe('top end')
    expect(reading(200, 100, 300)).toBe('top start end')
    expect(reading(0, 200, 300)).toBe('bottom start')
    // Right to left: the scroll origin is the right edge, and scrolling runs negative from it.
    expect(reading(0, -100, 300)).toBe('bottom start end')
    expect(reading(0, -200, 300)).toBe('bottom start')
    // Half a pixel short of an edge is at it.
    expect(reading(199.5, -0.5, 100)).toBe('top')
    geometry.height = 100
    expect(reading(0, 0, 100)).toBeNull()
})

// 32.103, 32.105, 32.106 — A BURST OF TRIGGERS ON TWO ELEMENTS IS ONE FRAME, IN WHICH EACH IS READ
// ONCE AND BOTH BEFORE EITHER IS WRITTEN, and a reading the attribute already holds writes nothing.
// Nothing is read at bind time or in a listener. THE REVERT: drop the `frame === 0` guard in `owe`;
// 10 frames are asked for 10 scroll events.
test('a burst of scrolls on two elements is one frame, every read before any write — 32.103, 32.105, 32.106', () => {
    const added: (boolean | undefined)[] = []
    const listen = Element.prototype.addEventListener
    Element.prototype.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
    ) {
        if (type === 'scroll')
            added.push((options as AddEventListenerOptions).passive)
        listen.call(this, type, listener, options)
    }
    let first: HTMLElement
    let second: HTMLElement
    try {
        ;({ element: first } = scroller())
        ;({ element: second } = scroller())
    } finally {
        Element.prototype.addEventListener = listen
    }
    expect(added).toEqual([true, true])
    expect(counts.reads).toBe(0)
    runFrame()
    expect(counts.log).toBe('rrww')
    counts.log = ''
    counts.frames = 0
    for (let event = 0; event < 5; event += 1) {
        first.dispatchEvent(new Event('scroll'))
        second.dispatchEvent(new Event('scroll'))
    }
    expect(counts.reads).toBe(2)
    expect(counts.frames).toBe(1)
    runFrame()
    expect(counts.log).toBe('rr')
})

// 32.103, 32.104 — CONTENT CHANGING DEEP INSIDE IS A READ, which the element's own box never shows:
// a node added, text changed, an attribute written two levels down and an image loading each owe
// one frame, and none of the nodes inside is observed for resizes. The element's own
// `data-scrollable` written owes nothing, so a frame that writes it is not followed by another.
// THE REVERT: drop the `data-scrollable` test from `contentChanged`; every frame that writes the
// attribute asks for one more, 1 frame where 0 are owed.
test('a change anywhere inside reads the element again, and its own mark does not — 32.103, 32.104', async () => {
    const { element, geometry } = scroller()
    const row = element.appendChild(document.createElement('p'))
    const label = row.appendChild(document.createElement('span'))
    const image = row.appendChild(document.createElement('img'))
    runFrame()
    await Bun.sleep(0)
    runFrame()
    expect(element.getAttribute('data-scrollable')).toBe('bottom')
    expect(
        [...resize.observed].filter((node) => element.contains(node)),
    ).toEqual([element])
    // The frame that wrote `bottom` has settled: nothing is owed.
    await Bun.sleep(0)
    expect(queued).toHaveLength(0)
    const owes = async (change: () => void): Promise<number> => {
        counts.frames = 0
        change()
        await Bun.sleep(0)
        const asked = counts.frames
        runFrame()
        return asked
    }
    expect(await owes(() => label.setAttribute('class', 'tall'))).toBe(1)
    expect(await owes(() => (label.textContent = 'Deal 1'))).toBe(1)
    expect(await owes(() => row.append(document.createElement('p')))).toBe(1)
    expect(await owes(() => image.dispatchEvent(new Event('load')))).toBe(1)
    geometry.height = 100
    expect(await owes(() => label.setAttribute('class', ''))).toBe(1)
    // That frame removed the mark, and the removal owes no frame after it.
    expect(element.getAttribute('data-scrollable')).toBeNull()
    await Bun.sleep(0)
    expect(`frames owed after the mark: ${queued.length}`).toBe(
        'frames owed after the mark: 0',
    )
})

// 32.107, 32.108 — STOPPING LEAVES NOTHING BEHIND, and a second bind of one element throws.
// THE REVERT: drop the `removeAttribute` from the `Disposer`; the element keeps `bottom`.
test('the Disposer removes the attribute and stops observing, and a second bind throws — 32.107, 32.108', () => {
    const { element, stop } = scroller()
    runFrame()
    expect(() => scrollEdges(element)).toThrow('RULEBOOK 32.108')
    stop()
    expect(element.hasAttribute('data-scrollable')).toBe(false)
    expect(resize.observed.has(element)).toBe(false)
    element.dispatchEvent(new Event('scroll'))
    expect(queued).toHaveLength(0)
    stops.push(scrollEdges(element))
})
