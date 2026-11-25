import { reactive } from '../reactive/index.ts'
import { isReactive } from '../reactive/isReactive.ts'
import type { Reactive } from '../reactive/Reactive.ts'
import { type Disposer, watchTracked } from '../reactive/watch.ts'
import { Measured } from './Measured.ts'
import { observedTwice } from './observedTwice.ts'
import { resized } from './resized.ts'

type Size = { width: number; height: number }
type SizeObserved = {
    readonly host: Record<string, unknown>
    readonly width: number | undefined
    readonly height: number | undefined
}

// 32.92 — the elements an `elementSize` is bound to, so a second one throws.
const bound = new WeakSet<Element>()

/**
 * The part writing an element's size into `target` as it is laid out.
 *
 * 32.79 — the box `box` names, as `ResizeObserver` names it: the content box by default (32.90);
 * 32.83 — its binding's `Disposer` stops observing.
 *
 * 32.82 — NOTHING IS READ HERE: a size read at bind time would force the layout the mount just
 * invalidated, and the observer's first delivery, which every observed element is owed, comes
 * after the layout the browser was going to do anyway. The target holds what the author gave it
 * until then.
 *
 * TWO FORMS PER OPTION, because 31.3 holds a name only where its position is a `Reactive`: a
 * position that also took the box itself would hand a `Reactive` box over read, once.
 */
export function elementSize(
    target: Reactive<unknown, Size, unknown, unknown>,
    options?: {
        box?:
            | Reactive<ResizeObserverBoxOptions, never, unknown, unknown>
            | undefined
    },
): Record<string, unknown>
export function elementSize(
    target: Reactive<unknown, Size, unknown, unknown>,
    options?: { box?: ResizeObserverBoxOptions | undefined },
): Record<string, unknown>
export function elementSize(
    target: (size: Size) => void,
    options?: {
        box?:
            | Reactive<ResizeObserverBoxOptions, never, unknown, unknown>
            | undefined
    },
): Record<string, unknown>
export function elementSize(
    target: (size: Size) => void,
    options?: { box?: ResizeObserverBoxOptions | undefined },
): Record<string, unknown>
/**
 * 32.110 — the size held for the reader: `host` to spread, and the width and the height read by
 * name, each a value of its own so a reader of one sleeps through a change of the other only.
 * `undefined` until the first observation (32.82).
 */
export function elementSize(options?: {
    box?:
        Reactive<ResizeObserverBoxOptions, never, unknown, unknown> | undefined
}): SizeObserved
export function elementSize(options?: {
    box?: ResizeObserverBoxOptions | undefined
}): SizeObserved
export function elementSize(
    target?: unknown,
    options?: { box?: unknown },
): Record<string, unknown> | SizeObserved {
    // 1.6 — a `Reactive` is a function, so the brand needs no read ahead of this one.
    if (typeof target === 'function')
        return {
            'data-element-size': 'host',
            'bind:element': sizeBinding(target, options),
        }
    const width = reactive<number | undefined>(undefined)
    const height = reactive<number | undefined>(undefined)
    const write = (measured: Size): void => {
        width.set(measured.width)
        height.set(measured.height)
    }
    return {
        host: {
            'data-element-size': 'host',
            'bind:element': sizeBinding(
                write,
                target as { box?: unknown } | undefined,
            ),
        },
        get width() {
            return width()
        },
        get height() {
            return height()
        },
    }
}

/** `elementSize`'s binding alone, for a part of the framework's own that measures an element it holds. */
export function sizeBinding(
    target: unknown,
    options?: { box?: unknown },
): (element: Element) => Disposer {
    const box = options?.box
    return (element) => {
        if (bound.has(element)) observedTwice('elementSize', element)
        bound.add(element)
        const measured = new Measured(target)
        // 32.90 — a box that moves observes the element again: the new listener is registered before
        // the old one leaves, so the shared observer is kept rather than dropped and made again.
        let unobserve: Disposer | undefined
        const observeIn = (asked: unknown): void => {
            const observed = (asked ??
                'content-box') as ResizeObserverBoxOptions
            const previous = unobserve
            unobserve = resized(
                element,
                (entry) => deliverSize(entry, measured, observed),
                observed,
            )
            previous?.()
        }
        let stop: Disposer | undefined
        if (isReactive(box))
            stop = watchTracked(() => {
                observeIn((box as () => unknown)())
            })
        else observeIn(box)
        return () => {
            stop?.()
            unobserve?.()
            bound.delete(element)
        }
    }
}

// 32.79 — A FRESH RECORD PER WRITE DEFEATS THE IDENTITY GATE, so a size the target already holds is
// not written: the first delivery of an element whose author seeded its size wakes nobody.
//
// `contentRect` for the content box because its width and height are the physical axes whatever the
// writing mode. The border box and the device-pixel content box have no physical spelling — each
// is inline and block — so 32.90's axes are turned by the element's writing mode, a style read made
// only for those two, after the layout the delivery follows and so never a forced one.
function deliverSize(
    entry: ResizeObserverEntry,
    measured: Measured,
    box: ResizeObserverBoxOptions,
): void {
    let width: number
    let height: number
    if (box === 'content-box') ({ width, height } = entry.contentRect)
    else {
        const sized = (
            box === 'border-box'
                ? entry.borderBoxSize[0]
                : entry.devicePixelContentBoxSize[0]
        ) as ResizeObserverSize
        const writingMode = getComputedStyle(entry.target).writingMode
        if (writingMode === '' || writingMode === 'horizontal-tb') {
            width = sized.inlineSize
            height = sized.blockSize
        } else {
            width = sized.blockSize
            height = sized.inlineSize
        }
    }
    const held = measured.held() as
        { width?: unknown; height?: unknown } | null | undefined
    if (held?.width === width && held.height === height) return
    measured.write({ width, height })
}
