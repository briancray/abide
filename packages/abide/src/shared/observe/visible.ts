import { isReactive } from '../reactive/isReactive.ts'
import type { Reactive } from '../reactive/Reactive.ts'
import { type Disposer, watchTracked } from '../reactive/watch.ts'
import { Measured } from './Measured.ts'
import { observedTwice } from './observedTwice.ts'

type Root = Element | Document

// 32.81 — ONE OBSERVER FOR EVERY `observe.visible` AGAINST THE VIEWPORT, made by the first and kept,
// for `size`'s reason. Keyed by the element, so a delivery finds what to write.
let observer: IntersectionObserver | undefined
const measuredBy = new WeakMap<Element, Measured>()
// 32.81, 32.89 — AN OBSERVER'S ROOT IS FIXED AT CONSTRUCTION, so each root is one observer shared by
// every element observed against it, made by the first and disconnected with the last.
const rooted = new WeakMap<Root, Rooted>()

class Rooted {
    observer: IntersectionObserver
    observed = 0

    constructor(root: Root) {
        this.observer = new IntersectionObserver(deliverIntersections, {
            root,
        })
    }
}

/**
 * The `bind:element` callback writing whether an element intersects the viewport into `target`.
 *
 * 32.80 — against the viewport, or 32.89 the root `in` holds; 32.83 — the `Disposer` it hands back
 * stops observing.
 *
 * 32.82 — nothing is read at bind time (`size`'s reason): the observer's first delivery says where
 * the element stands, and the target holds what the author gave it until then.
 *
 * Two forms per option, for `size`'s reason.
 */
export function visible(
    target: Reactive<unknown, boolean, unknown, unknown>,
    options?: {
        in?: Reactive<Root | null | undefined, never, unknown, unknown>
    },
): (element: Element) => Disposer
export function visible(
    target: Reactive<unknown, boolean, unknown, unknown>,
    options?: { in?: Root },
): (element: Element) => Disposer
export function visible(
    target: (visible: boolean) => void,
    options?: {
        in?: Reactive<Root | null | undefined, never, unknown, unknown>
    },
): (element: Element) => Disposer
export function visible(
    target: (visible: boolean) => void,
    options?: { in?: Root },
): (element: Element) => Disposer
export function visible(
    target: unknown,
    options?: { in?: unknown },
): (element: Element) => Disposer {
    const root = options?.in
    return (element) => {
        if (measuredBy.has(element)) observedTwice('visible', element)
        measuredBy.set(element, new Measured(target))
        if (root === undefined || root === null) {
            observer ??= new IntersectionObserver(deliverIntersections)
            observer.observe(element)
            return () => {
                measuredBy.delete(element)
                ;(observer as IntersectionObserver).unobserve(element)
            }
        }
        if (!isReactive(root)) {
            observeIn(root as Root, element)
            return () => {
                measuredBy.delete(element)
                release(root as Root, element)
            }
        }
        // 32.89 — no root yet is nothing observed: a `bind:element` sets its value after the binds
        // of the element's children, so a root read as the viewport would deliver an answer to the
        // wrong question first.
        let current: Root | undefined
        const stop = watchTracked(() => {
            const next = ((root as () => Root | null | undefined)() ??
                undefined) as Root | undefined
            if (next === current) return
            if (current !== undefined) release(current, element)
            current = next
            if (next !== undefined) observeIn(next, element)
        })
        return () => {
            stop()
            measuredBy.delete(element)
            if (current !== undefined) release(current, element)
            current = undefined
        }
    }
}

function observeIn(root: Root, element: Element): void {
    let shared = rooted.get(root)
    if (shared === undefined) {
        shared = new Rooted(root)
        rooted.set(root, shared)
    }
    shared.observed += 1
    shared.observer.observe(element)
}

function release(root: Root, element: Element): void {
    const shared = rooted.get(root) as Rooted
    shared.observer.unobserve(element)
    shared.observed -= 1
    if (shared.observed > 0) return
    shared.observer.disconnect()
    rooted.delete(root)
}

// The same boolean written twice to a `Reactive` is collapsed by its own identity gate.
function deliverIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
        measuredBy.get(entry.target)?.write(entry.isIntersecting)
    }
}
