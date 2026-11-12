import { heldValue, writeBound } from '#shared/boundValue.ts'

import type { Scope } from './Scope.ts'

// 32.88 — ONE LISTENER SET FOR EVERY `bind:rect` IN THE DOCUMENT, added with the first and removed
// with the last. A scroll is listened for in CAPTURE, where a nested scroller's scroll reaches the
// window though the event does not bubble. 32.82 — the third shared observer, for resizes of the
// elements themselves.
// A Map rather than a WeakMap: the frame walks every bound element, and teardown deletes each one.
const bound = new Map<Element, Placed>()
let observer: ResizeObserver | undefined
let frame = 0
// Whether a scroll event arrived since the last frame: such a frame reads and writes but arms
// nothing (32.90), and asks for the frame after it, where the scroll is over unless another came.
let scrolled = false
const SCROLLING: AddEventListenerOptions = { capture: true, passive: true }
const RESIZING: AddEventListenerOptions = { passive: true }
// The frame's reads, kept between frames so a frame allocates no array.
const elements: Element[] = []
const rects: DOMRect[] = []

/**
 * One `bind:rect`: the value it writes, and the observer watching its element's own box.
 *
 * 32.87 — A MOVE IS SEEN BY OBSERVING THE ELEMENT'S OWN BOX: an `IntersectionObserver` whose root
 * is shrunk by `rootMargin` to the rectangle the last frame read, so the element fills it and any
 * move changes how much of it does. A margin is fixed per observer, so it is one per element, made
 * again only in a frame no scroll preceded whose read moved the element or resized the viewport
 * (32.90). The insets it was made with are kept so that frame can tell.
 */
class Placed {
    operand: unknown
    position: IntersectionObserver | undefined = undefined
    top = 0
    right = 0
    bottom = 0
    left = 0
    // The share of the element inside the root it was armed at: 1, or what a clipped element's
    // first delivery reported, so a move is a delivery reporting any other.
    threshold = 1
    // Whether the observer's first delivery, which every observer makes, is still to come.
    first = true

    constructor(operand: unknown) {
        this.operand = operand
    }
}

/**
 * 32.86 — writes an element's rectangle in the viewport into its `bind:rect` value whenever a
 * resize of it, a scroll or a window resize may have moved it, and
 * 32.85 — stops observing it at the scope's teardown.
 *
 * 32.89 — NOTHING IS READ HERE: binding schedules the frame every bound element is read in, so a
 * mount of a hundred rows is one batch of reads in one frame rather than a forced layout per row.
 * 32.87 — a move none of the three accompanies (a sibling above growing) is seen by the element's
 * position observer, which the frame arms.
 */
export function bindRect(
    element: Element,
    operand: unknown,
    scope: Scope,
): void {
    if (bound.size === 0) {
        addEventListener('scroll', scroll, SCROLLING)
        addEventListener('resize', schedule, RESIZING)
    }
    const placed = new Placed(operand)
    bound.set(element, placed)
    observer ??= new ResizeObserver(schedule)
    observer.observe(element)
    schedule()
    scope.stops.push(() => {
        bound.delete(element)
        ;(observer as ResizeObserver).unobserve(element)
        placed.position?.disconnect()
        if (bound.size > 0) return
        removeEventListener('scroll', scroll, SCROLLING)
        removeEventListener('resize', schedule, RESIZING)
        if (frame !== 0) cancelAnimationFrame(frame)
        frame = 0
        scrolled = false
    })
}

// 32.89 — EVERY TRIGGER BEFORE THE NEXT FRAME IS THAT ONE FRAME: a burst of scroll events reads each
// element once.
function schedule(): void {
    if (frame === 0) frame = requestAnimationFrame(measure)
}

function scroll(): void {
    scrolled = true
    schedule()
}

// 32.89 — EVERY READ BEFORE ANY WRITE: a write wakes readers that may write the DOM, and a read
// after one would force the layout it invalidated, once per element.
// 32.86 — a fresh record per write defeats the identity gate, so a rectangle the value already
// holds is not written: the four it is made of decide the other four.
function measure(): void {
    frame = 0
    // 32.90 — A SCROLL MOVES EVERY ELEMENT AND ITS OWN LISTENER ALREADY SEES THE NEXT STEP, so the
    // observers are left standing until the first frame no scroll event preceded, and made there.
    const scrolling = scrolled
    scrolled = false
    if (scrolling) schedule()
    let count = 0
    for (const element of bound.keys()) {
        elements[count] = element
        rects[count] = element.getBoundingClientRect()
        count += 1
    }
    // The viewport the position observers' margins are taken against, read with the rectangles.
    const viewport = document.documentElement
    const viewportWidth = viewport.clientWidth
    const viewportHeight = viewport.clientHeight
    for (let index = 0; index < count; index += 1) {
        const element = elements[index] as Element
        const rect = rects[index] as DOMRect
        const placed = bound.get(element)
        if (placed === undefined) continue
        if (!scrolling)
            arm(element, placed, rect, viewportWidth, viewportHeight)
        const operand = placed.operand
        const held = heldValue(operand) as
            | { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
            | null
            | undefined
        if (
            held?.x === rect.x &&
            held.y === rect.y &&
            held.width === rect.width &&
            held.height === rect.height
        )
            continue
        writeBound(operand, {
            x: rect.x,
            y: rect.y,
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
        })
    }
    elements.length = 0
    rects.length = 0
}

/**
 * 32.90 — makes the element's position observer around `rect`, unless the one standing was made
 * around the same insets. Floored outward, so the root holds the whole element.
 */
function arm(
    element: Element,
    placed: Placed,
    rect: DOMRect,
    viewportWidth: number,
    viewportHeight: number,
): void {
    const top = Math.floor(rect.top)
    const left = Math.floor(rect.left)
    const right = Math.floor(viewportWidth - rect.right)
    const bottom = Math.floor(viewportHeight - rect.bottom)
    if (
        placed.position !== undefined &&
        placed.top === top &&
        placed.left === left &&
        placed.right === right &&
        placed.bottom === bottom
    )
        return
    placed.top = top
    placed.left = left
    placed.right = right
    placed.bottom = bottom
    observePosition(element, placed, 1)
}

function observePosition(
    element: Element,
    placed: Placed,
    threshold: number,
): void {
    placed.position?.disconnect()
    placed.threshold = threshold
    placed.first = true
    placed.position = new IntersectionObserver(deliverPositions, {
        root: document,
        rootMargin: `${-placed.top}px ${-placed.right}px ${-placed.bottom}px ${-placed.left}px`,
        threshold,
    })
    placed.position.observe(element)
}

// 32.87, 32.89 — A DELIVERY READS NOTHING: a move schedules the frame, which reads and arms again. The
// first delivery is the observer saying where it started — the threshold where the element is
// whole in the root, and otherwise the share a clip leaves, which it is armed again at once.
function deliverPositions(
    entries: IntersectionObserverEntry[],
    observer: IntersectionObserver,
): void {
    for (const entry of entries) {
        const element = entry.target
        const placed = bound.get(element)
        if (placed === undefined || placed.position !== observer) continue
        const ratio = entry.intersectionRatio
        const first = placed.first
        placed.first = false
        if (ratio === placed.threshold) continue
        if (!first) schedule()
        else if (ratio > 0 && placed.threshold === 1)
            observePosition(element, placed, ratio)
    }
}
