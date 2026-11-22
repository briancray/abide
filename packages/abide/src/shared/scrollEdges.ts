// 32.101-32.108 — a scrolling element marked with the edges it can still scroll toward, for a
// stylesheet to fade or shadow.

import { resized } from './observe/resized.ts'
import type { Disposer } from './reactive/watch.ts'

// How near an edge, in pixels, still counts as at it: a fractional scroll position rounds short.
const AT_EDGE = 1

/** One element `scrollEdges` is bound to, and what observes it. */
class Edged {
    element: Element
    // What `data-scrollable` holds, so an unchanged reading writes nothing.
    tokens = ''
    unresize: Disposer
    mutations: MutationObserver

    constructor(element: Element) {
        this.element = element
        this.unresize = resized(element, ownResized)
        this.mutations = new MutationObserver(contentChanged)
        observedBy.set(this.mutations, this)
    }
}

const bound = new WeakMap<Element, Edged>()
// A record names the node that changed, deep in the subtree, so the observer is what finds the
// element it belongs to.
const observedBy = new WeakMap<MutationObserver, Edged>()
// 32.106 — the elements the next frame reads, and the frame.
const owed = new Set<Edged>()
let frame = 0
const SCROLLING: AddEventListenerOptions = { passive: true }
// 32.103 — `load` does not bubble, so an image or a frame loading inside is heard in capture.
const LOADING: AddEventListenerOptions = { capture: true, passive: true }
const CONTENT: MutationObserverInit = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
}
// The frame's readings, kept between frames so a frame allocates no array.
const read: Edged[] = []
const readings: string[] = []

/**
 * The part writing on the scrolling element it is spread on, as `data-scrollable`, which of its
 * edges content lies beyond — `top`, `bottom`, `start`, `end` — as it scrolls, resizes or its
 * content changes.
 *
 * 32.106 — NOTHING IS READ HERE: binding owes the element a read in the next frame, where every
 * owed element is read before any is written.
 *
 * 32.103 — CONTENT IS WATCHED FOR CHANGE, NOT FOR SIZE. A resize observation per child also saw a
 * row grow under a stylesheet's transition, and was dropped for its price: `bench:edges` measured it
 * at 3.2x the hand-written arm's main thread per idle frame on a 1000-row list — paid every frame
 * whether or not anything changed, where a mutation costs only when one happens.
 */
export function scrollEdges(): Record<string, unknown> {
    return { 'data-scroll-edges': 'host', 'bind:element': edgesOf }
}

function edgesOf(element: Element): Disposer {
    if (bound.has(element))
        throw new Error(
            `abide: <${element.localName}> is bound to scrollEdges twice — one element takes one scrollEdges. RULEBOOK 32.108.`,
        )
    const edged = new Edged(element)
    bound.set(element, edged)
    edged.mutations.observe(element, CONTENT)
    element.addEventListener('scroll', listened, SCROLLING)
    element.addEventListener('load', listened, LOADING)
    owe(edged)
    return () => {
        if (bound.get(element) !== edged) return
        bound.delete(element)
        owed.delete(edged)
        element.removeEventListener('scroll', listened, SCROLLING)
        element.removeEventListener('load', listened, LOADING)
        edged.mutations.disconnect()
        edged.unresize()
        element.removeAttribute('data-scrollable')
    }
}

function owe(edged: Edged): void {
    owed.add(edged)
    if (frame === 0) frame = requestAnimationFrame(measure)
}

function listened(event: Event): void {
    const edged = bound.get(event.currentTarget as Element)
    if (edged !== undefined) owe(edged)
}

function ownResized(entry: ResizeObserverEntry): void {
    const edged = bound.get(entry.target)
    if (edged !== undefined) owe(edged)
}

// The element's own `data-scrollable` written is the one change that owes no read.
function contentChanged(
    records: MutationRecord[],
    observer: MutationObserver,
): void {
    const edged = observedBy.get(observer)
    if (edged === undefined) return
    for (const record of records)
        if (
            record.target !== edged.element ||
            record.attributeName !== 'data-scrollable'
        ) {
            owe(edged)
            return
        }
}

// 32.106 — EVERY READ BEFORE ANY WRITE: a write invalidates style, and a read after one would force
// the layout it invalidated, once per element.
// 32.102 — the horizontal scroll position is read as its distance from the start: a right-to-left
// scroller's runs from zero down to the negative of its overflow.
function measure(): void {
    frame = 0
    let count = 0
    for (const edged of owed) {
        const element = edged.element
        const top = element.scrollTop
        const fromStart = Math.abs(element.scrollLeft)
        const overflowHeight = element.scrollHeight - element.clientHeight
        const overflowWidth = element.scrollWidth - element.clientWidth
        let tokens = ''
        if (top >= AT_EDGE) tokens = 'top'
        if (overflowHeight - top >= AT_EDGE)
            tokens = tokens === '' ? 'bottom' : `${tokens} bottom`
        if (fromStart >= AT_EDGE)
            tokens = tokens === '' ? 'start' : `${tokens} start`
        if (overflowWidth - fromStart >= AT_EDGE)
            tokens = tokens === '' ? 'end' : `${tokens} end`
        read[count] = edged
        readings[count] = tokens
        count += 1
    }
    owed.clear()
    for (let index = 0; index < count; index += 1) {
        const edged = read[index] as Edged
        const tokens = readings[index] as string
        if (edged.tokens === tokens) continue
        edged.tokens = tokens
        if (tokens === '') edged.element.removeAttribute('data-scrollable')
        else edged.element.setAttribute('data-scrollable', tokens)
    }
    read.length = 0
    readings.length = 0
}
