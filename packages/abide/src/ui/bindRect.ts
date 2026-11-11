import { heldValue, writeBound } from '#shared/boundValue.ts'

import type { Scope } from './Scope.ts'

// 32.88 — ONE LISTENER SET FOR EVERY `bind:rect` IN THE DOCUMENT, added with the first and removed
// with the last. A scroll is listened for in CAPTURE, where a nested scroller's scroll reaches the
// window though the event does not bubble. 32.82 — the third shared observer, for resizes of the
// elements themselves.
// A Map rather than a WeakMap: the frame walks every bound element, and teardown deletes each one.
const bound = new Map<Element, unknown>()
let observer: ResizeObserver | undefined
let frame = 0
const SCROLLING: AddEventListenerOptions = { capture: true, passive: true }
const RESIZING: AddEventListenerOptions = { passive: true }
// The frame's reads, kept between frames so a frame allocates no array.
const elements: Element[] = []
const rects: DOMRect[] = []

/**
 * 32.86 — writes an element's rectangle in the viewport into its `bind:rect` value whenever a
 * resize of it, a scroll or a window resize may have moved it, and
 * 32.85 — stops observing it at the scope's teardown.
 *
 * 32.89 — NOTHING IS READ HERE: binding schedules the frame every bound element is read in, so a
 * mount of a hundred rows is one batch of reads in one frame rather than a forced layout per row.
 * 32.87 — a move nothing of the three accompanies (a sibling above growing) is not seen.
 */
export function bindRect(
    element: Element,
    operand: unknown,
    scope: Scope,
): void {
    if (bound.size === 0) {
        addEventListener('scroll', schedule, SCROLLING)
        addEventListener('resize', schedule, RESIZING)
    }
    bound.set(element, operand)
    observer ??= new ResizeObserver(schedule)
    observer.observe(element)
    schedule()
    scope.stops.push(() => {
        bound.delete(element)
        ;(observer as ResizeObserver).unobserve(element)
        if (bound.size > 0) return
        removeEventListener('scroll', schedule, SCROLLING)
        removeEventListener('resize', schedule, RESIZING)
        if (frame !== 0) cancelAnimationFrame(frame)
        frame = 0
    })
}

// 32.89 — EVERY TRIGGER BEFORE THE NEXT FRAME IS THAT ONE FRAME: a burst of scroll events reads each
// element once.
function schedule(): void {
    if (frame === 0) frame = requestAnimationFrame(measure)
}

// 32.89 — EVERY READ BEFORE ANY WRITE: a write wakes readers that may write the DOM, and a read
// after one would force the layout it invalidated, once per element.
// 32.86 — a fresh record per write defeats the identity gate, so a rectangle the value already
// holds is not written: the four it is made of decide the other four.
function measure(): void {
    frame = 0
    let count = 0
    for (const element of bound.keys()) {
        elements[count] = element
        rects[count] = element.getBoundingClientRect()
        count += 1
    }
    for (let index = 0; index < count; index += 1) {
        const element = elements[index] as Element
        const rect = rects[index] as DOMRect
        const operand = bound.get(element)
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
