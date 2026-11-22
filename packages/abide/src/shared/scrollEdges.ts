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
    // Each element child, and what stops the shared resize observer telling its resizes.
    children = new Map<Element, Disposer>()
    mutations: MutationObserver

    constructor(element: Element) {
        this.element = element
        this.unresize = resized(element, ownResized)
        this.mutations = new MutationObserver(childrenChanged)
    }
}

const bound = new WeakMap<Element, Edged>()
// 32.106 — the elements the next frame reads, and the frame.
const owed = new Set<Edged>()
let frame = 0
const SCROLLING: AddEventListenerOptions = { passive: true }
const CHILDREN: MutationObserverInit = { childList: true }
// The frame's readings, kept between frames so a frame allocates no array.
const read: Edged[] = []
const readings: string[] = []

/**
 * The `bind:element` callback writing on a scrolling element, as `data-scrollable`, which of its
 * edges content lies beyond — `top`, `bottom`, `start`, `end` — as it scrolls, resizes or its
 * content changes.
 *
 * 32.106 — NOTHING IS READ HERE: binding owes the element a read in the next frame, where every
 * owed element is read before any is written.
 */
export function scrollEdges(element: Element): Disposer {
    if (bound.has(element))
        throw new Error(
            `abide: <${element.localName}> is bound to scrollEdges twice — one element takes one scrollEdges. RULEBOOK 32.108.`,
        )
    const edged = new Edged(element)
    bound.set(element, edged)
    for (const child of element.children) observeChild(edged, child)
    edged.mutations.observe(element, CHILDREN)
    element.addEventListener('scroll', scrolled, SCROLLING)
    owe(edged)
    return () => {
        if (bound.get(element) !== edged) return
        bound.delete(element)
        owed.delete(edged)
        element.removeEventListener('scroll', scrolled, SCROLLING)
        edged.mutations.disconnect()
        edged.unresize()
        for (const stop of edged.children.values()) stop()
        edged.children.clear()
        element.removeAttribute('data-scrollable')
    }
}

function owe(edged: Edged): void {
    owed.add(edged)
    if (frame === 0) frame = requestAnimationFrame(measure)
}

// 32.104 — a child resizing is content growing or shrinking where the element's own box may not move,
// and is delivered too when a closed `<details>` around the element opens over content that changed
// while it was closed.
function observeChild(edged: Edged, child: Element): void {
    if (!edged.children.has(child))
        edged.children.set(child, resized(child, childResized))
}

function scrolled(event: Event): void {
    const edged = bound.get(event.currentTarget as Element)
    if (edged !== undefined) owe(edged)
}

function ownResized(entry: ResizeObserverEntry): void {
    const edged = bound.get(entry.target)
    if (edged !== undefined) owe(edged)
}

function childResized(entry: ResizeObserverEntry): void {
    const parent = entry.target.parentElement
    const edged = parent === null ? undefined : bound.get(parent)
    if (edged !== undefined) owe(edged)
}

// Records name the element observed, since its children alone are, so no ancestor walk finds it.
function childrenChanged(records: MutationRecord[]): void {
    for (const record of records) {
        const edged = bound.get(record.target as Element)
        if (edged === undefined) continue
        for (const node of record.removedNodes) {
            const stop = edged.children.get(node as Element)
            if (stop === undefined) continue
            stop()
            edged.children.delete(node as Element)
        }
        for (const node of record.addedNodes)
            if (node.nodeType === 1 && node.parentNode === edged.element)
                observeChild(edged, node as Element)
        owe(edged)
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
