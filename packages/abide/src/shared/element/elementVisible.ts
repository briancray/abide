import { reactive } from '../reactive/index.ts'
import { isReactive } from '../reactive/isReactive.ts'
import type { Reactive } from '../reactive/Reactive.ts'
import { type Disposer, watchTracked } from '../reactive/watch.ts'
import { Measured } from './Measured.ts'
import { observedTwice } from './observedTwice.ts'

type Root = Element | Document
type VisibleObserved = {
    readonly host: Record<string, unknown>
    readonly visible: boolean | undefined
}
/** `IntersectionObserver`'s own options beside `root`, under its own names. */
type Margins = {
    rootMargin?: string | undefined
    threshold?: number | number[] | undefined
}

const measuredBy = new WeakMap<Element, Seen>()
// 32.81, 32.89, 32.98 — AN OBSERVER'S ROOT, MARGIN AND THRESHOLDS ARE FIXED AT CONSTRUCTION, so
// each root — the viewport (`null`) among them — with each margin and thresholds is one observer
// shared by every element observed against it, made by the first and disconnected with the last, so
// the next is made by whatever `IntersectionObserver` stands then. Keyed by the element, so a
// delivery finds what to write.
const viewport = new Map<string, Rooted>()
const rooted = new WeakMap<Root, Map<string, Rooted>>()

/**
 * One `elementVisible`: what it writes, the share of it that counts as in view, and — under
 * 32.100's `once` — how its element stops being observed after the first `true`.
 */
class Seen extends Measured {
    stop: Disposer | undefined = undefined
    once: boolean
    least: number

    constructor(target: unknown, once: boolean, least: number) {
        super(target)
        this.once = once
        this.least = least
    }
}

class Rooted {
    observer: IntersectionObserver
    observed = 0

    constructor(root: Root | null, margins: Margins) {
        // Only what was given, so a bare viewport observer is made with no options at all.
        let init: IntersectionObserverInit | undefined
        if (root !== null) init = { root }
        if (margins.rootMargin !== undefined)
            init = { ...init, rootMargin: margins.rootMargin }
        if (margins.threshold !== undefined)
            init = { ...init, threshold: margins.threshold }
        this.observer = new IntersectionObserver(deliverIntersections, init)
    }
}

/**
 * The part writing whether an element intersects the viewport into `target`.
 *
 * 32.80 — against the viewport, or 32.89 the root `root` holds, as `IntersectionObserver` takes
 * `root`, `rootMargin` and `threshold`; 32.83 — its binding's `Disposer` stops observing, and 32.100
 * `once` stops it after the first `true`.
 *
 * 32.82 — nothing is read at bind time (`elementSize`'s reason): the observer's first delivery says
 * where the element stands, and the target holds what the author gave it until then.
 *
 * Two forms per option, for `elementSize`'s reason.
 */
export function elementVisible(
    target: Reactive<unknown, boolean, unknown, unknown>,
    options?: Margins & {
        root?:
            | Reactive<Root | null | undefined, never, unknown, unknown>
            | undefined
        once?: boolean | undefined
    },
): Record<string, unknown>
export function elementVisible(
    target: Reactive<unknown, boolean, unknown, unknown>,
    options?: Margins & { root?: Root | undefined; once?: boolean | undefined },
): Record<string, unknown>
export function elementVisible(
    target: (visible: boolean) => void,
    options?: Margins & {
        root?:
            | Reactive<Root | null | undefined, never, unknown, unknown>
            | undefined
        once?: boolean | undefined
    },
): Record<string, unknown>
export function elementVisible(
    target: (visible: boolean) => void,
    options?: Margins & { root?: Root | undefined; once?: boolean | undefined },
): Record<string, unknown>
/**
 * 32.110 — whether it is in view, held for the reader: `host` to spread and `visible` read by
 * name, `undefined` until the first observation (32.82).
 */
export function elementVisible(
    options?: Margins & {
        root?:
            | Reactive<Root | null | undefined, never, unknown, unknown>
            | undefined
        once?: boolean | undefined
    },
): VisibleObserved
export function elementVisible(
    options?: Margins & { root?: Root | undefined; once?: boolean | undefined },
): VisibleObserved
export function elementVisible(
    target?: unknown,
    options?: Margins & { root?: unknown; once?: boolean | undefined },
): Record<string, unknown> | VisibleObserved {
    // 1.6 — the brand first: a `Reactive` target, or a function handing back the element.
    if (isReactive(target) || typeof target === 'function')
        return {
            'data-element-visible': 'host',
            'bind:element': visibleBinding(target, options),
        }
    const seen = reactive<boolean | undefined>(undefined)
    return {
        host: {
            'data-element-visible': 'host',
            'bind:element': visibleBinding(
                seen,
                target as
                    | (Margins & { root?: unknown; once?: boolean | undefined })
                    | undefined,
            ),
        },
        get visible() {
            return seen.get()
        },
    }
}

// The binding the part carries.
function visibleBinding(
    target: unknown,
    options?: Margins & { root?: unknown; once?: boolean | undefined },
): (element: Element) => Disposer {
    const root = options?.root
    const once = options?.once === true
    const margins: Margins = {
        rootMargin: options?.rootMargin,
        threshold: options?.threshold,
    }
    const key = `${margins.rootMargin ?? ''} ${String(margins.threshold ?? '')}`
    const least = leastOf(margins.threshold)
    return (element) => {
        if (measuredBy.has(element)) observedTwice('elementVisible', element)
        const seen = new Seen(target, once, least)
        measuredBy.set(element, seen)
        if (!isReactive(root)) {
            const fixed = (root ?? null) as Root | null
            observeIn(fixed, key, margins, element)
            seen.stop = () => {
                if (measuredBy.get(element) !== seen) return
                measuredBy.delete(element)
                release(fixed, key, element)
            }
            return seen.stop
        }
        // 32.89 — no root yet is nothing observed: a `bind:element` sets its value after the binds
        // of the element's children, so a root read as the viewport would deliver an answer to the
        // wrong question first.
        let current: Root | undefined
        const unwatch = watchTracked(() => {
            const next = ((root as Reactive<Root | null | undefined>).get() ??
                undefined) as Root | undefined
            if (next === current) return
            if (current !== undefined) release(current, key, element)
            current = next
            if (next !== undefined) observeIn(next, key, margins, element)
        })
        seen.stop = () => {
            unwatch()
            if (measuredBy.get(element) !== seen) return
            measuredBy.delete(element)
            if (current !== undefined) release(current, key, element)
            current = undefined
        }
        return seen.stop
    }
}

// 32.112 — the smallest share of the element a threshold names, the share past which it is in view.
function leastOf(threshold: number | number[] | undefined): number {
    if (threshold === undefined) return 0
    if (typeof threshold === 'number') return threshold
    let least = 1
    for (const each of threshold) if (each < least) least = each
    return threshold.length === 0 ? 0 : least
}

function observeIn(
    root: Root | null,
    key: string,
    margins: Margins,
    element: Element,
): void {
    let byKey = root === null ? viewport : rooted.get(root)
    if (byKey === undefined) {
        byKey = new Map()
        rooted.set(root as Root, byKey)
    }
    let shared = byKey.get(key)
    if (shared === undefined) {
        shared = new Rooted(root, margins)
        byKey.set(key, shared)
    }
    shared.observed += 1
    shared.observer.observe(element)
}

function release(root: Root | null, key: string, element: Element): void {
    const byKey = (root === null ? viewport : rooted.get(root)) as Map<
        string,
        Rooted
    >
    const shared = byKey.get(key) as Rooted
    shared.observer.unobserve(element)
    shared.observed -= 1
    if (shared.observed > 0) return
    shared.observer.disconnect()
    byKey.delete(key)
    if (root !== null && byKey.size === 0) rooted.delete(root)
}

// The same boolean written twice to a `Reactive` is collapsed by its own identity gate.
// 32.100 — a `once` element is released after its first `true` is written, within the delivery.
// 32.112 — in view is intersecting by at least the smallest share `threshold` names.
function deliverIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
        const seen = measuredBy.get(entry.target)
        if (seen === undefined) continue
        const inView =
            entry.isIntersecting &&
            (seen.least === 0 || entry.intersectionRatio >= seen.least)
        seen.write(inView)
        if (seen.once && inView) seen.stop?.()
    }
}
