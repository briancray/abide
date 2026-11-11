import { writeBound } from '#shared/boundValue.ts'

import type { Scope } from './Scope.ts'

// 32.82 — ONE OBSERVER FOR EVERY `bind:visible` IN THE DOCUMENT, made by the first and kept, for
// `bindSize`'s reason. Keyed by the element, so a delivery finds the operand to write.
let observer: IntersectionObserver | undefined
const operands = new WeakMap<Element, unknown>()

/**
 * 32.80 — writes whether an element intersects the viewport into its `bind:visible` value, and
 * 32.85 — stops observing it at the scope's teardown.
 *
 * 32.83 — nothing is read at bind time (`bindSize`'s reason): the observer's first delivery says where
 * the element stands, and the value holds what the author gave it until then. The same boolean
 * written twice is collapsed by the value's own identity gate.
 */
export function bindVisible(
    element: Element,
    operand: unknown,
    scope: Scope,
): void {
    observer ??= new IntersectionObserver(deliverIntersections)
    operands.set(element, operand)
    observer.observe(element)
    scope.stops.push(() => {
        operands.delete(element)
        ;(observer as IntersectionObserver).unobserve(element)
    })
}

function deliverIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
        const operand = operands.get(entry.target)
        if (operand !== undefined) writeBound(operand, entry.isIntersecting)
    }
}
