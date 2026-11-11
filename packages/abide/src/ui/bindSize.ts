import { heldValue, writeBound } from '#shared/boundValue.ts'

import type { Scope } from './Scope.ts'

// 32.82 — ONE OBSERVER FOR EVERY `bind:size` IN THE DOCUMENT, made by the first and kept: an observer
// per element is a callback per element per frame a layout moves, where one hands every resize of
// the frame over in a single batch. Keyed by the element, so a delivery finds the operand to write.
let observer: ResizeObserver | undefined
const operands = new WeakMap<Element, unknown>()

/**
 * 32.79 — writes an element's content-box size into its `bind:size` value as it is laid out, and
 * 32.85 — stops observing it at the scope's teardown.
 *
 * 32.83 — NOTHING IS READ HERE: a size read at bind time would force the layout the mount just
 * invalidated, and the observer's first delivery, which every observed element is owed, comes
 * after the layout the browser was going to do anyway. The value holds what the author gave it
 * until then. `contentRect` because its width and height are the physical axes whatever the
 * writing mode, where `contentBoxSize` is inline and block.
 */
export function bindSize(
    element: Element,
    operand: unknown,
    scope: Scope,
): void {
    observer ??= new ResizeObserver(deliverSizes)
    operands.set(element, operand)
    observer.observe(element)
    scope.stops.push(() => {
        operands.delete(element)
        ;(observer as ResizeObserver).unobserve(element)
    })
}

// 32.79 — A FRESH RECORD PER WRITE DEFEATS THE IDENTITY GATE, so a size the value already holds is not
// written: the first delivery of an element whose author seeded its size wakes nobody.
function deliverSizes(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
        const operand = operands.get(entry.target)
        if (operand === undefined) continue
        const { width, height } = entry.contentRect
        const held = heldValue(operand) as
            { width?: unknown; height?: unknown } | null | undefined
        if (held?.width === width && held.height === height) continue
        writeBound(operand, { width, height })
    }
}
