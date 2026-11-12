import { writeBound } from '#shared/boundValue.ts'

import type { Scope } from './Scope.ts'

// 32.82 — ONE OBSERVER FOR EVERY `bind:visible` AGAINST THE VIEWPORT, made by the first and kept, for
// `bindSize`'s reason. Keyed by the element, so a delivery finds the operand to write.
let observer: IntersectionObserver | undefined
const operands = new WeakMap<Element, unknown>()
// 32.82, 32.91 — AN OBSERVER'S ROOT IS FIXED AT CONSTRUCTION, so each root is one observer shared by
// every element observed against it, made by the first and disconnected with the last.
const rooted = new WeakMap<Element | Document, Rooted>()

class Rooted {
    observer: IntersectionObserver
    observed = 0

    constructor(root: Element | Document) {
        this.observer = new IntersectionObserver(deliverIntersections, {
            root,
        })
    }
}

/**
 * 32.80 — writes whether an element intersects the viewport, or 32.91 the root its `visibleIn`
 * holds, into its `bind:visible` value, and 32.85 — stops observing it at the scope's teardown.
 *
 * 32.83 — nothing is read at bind time (`bindSize`'s reason): the observer's first delivery says where
 * the element stands, and the value holds what the author gave it until then. The same boolean
 * written twice is collapsed by the value's own identity gate.
 *
 * `root` is the compiled `visibleIn`, watched so a root that moves is observed against again, and
 * absent where the tag has none.
 */
export function bindVisible(
    element: Element,
    operand: unknown,
    scope: Scope,
    root?: () => Element | Document | null | undefined,
): void {
    operands.set(element, operand)
    if (root === undefined) {
        observer ??= new IntersectionObserver(deliverIntersections)
        observer.observe(element)
        scope.stops.push(() => {
            operands.delete(element)
            ;(observer as IntersectionObserver).unobserve(element)
        })
        return
    }
    // 32.91 — no root yet is nothing observed: a `bind:element` sets its value after the binds of
    // the element's children, so a root read as the viewport would deliver an answer to the wrong
    // question first.
    let current: Element | Document | undefined
    scope.watch(() => {
        const next = root() ?? undefined
        if (next === current) return
        if (current !== undefined) release(current, element)
        current = next
        if (next !== undefined) observeIn(next, element)
    })
    scope.stops.push(() => {
        operands.delete(element)
        if (current !== undefined) release(current, element)
        current = undefined
    })
}

function observeIn(root: Element | Document, element: Element): void {
    let shared = rooted.get(root)
    if (shared === undefined) {
        shared = new Rooted(root)
        rooted.set(root, shared)
    }
    shared.observed += 1
    shared.observer.observe(element)
}

function release(root: Element | Document, element: Element): void {
    const shared = rooted.get(root) as Rooted
    shared.observer.unobserve(element)
    shared.observed -= 1
    if (shared.observed > 0) return
    shared.observer.disconnect()
    rooted.delete(root)
}

function deliverIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
        const operand = operands.get(entry.target)
        if (operand !== undefined) writeBound(operand, entry.isIntersecting)
    }
}
