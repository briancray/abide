import { isReactive } from '../reactive/isReactive.ts'
import type { Reactive } from '../reactive/Reactive.ts'
import { type Disposer, watchTracked } from '../reactive/watch.ts'
import { Measured } from './Measured.ts'
import { observedTwice } from './observedTwice.ts'

type Size = { width: number; height: number }
type Box = 'content' | 'border'

// 32.81 — ONE OBSERVER FOR EVERY `observe.size` IN THE DOCUMENT, made by the first and kept: an
// observer per element is a callback per element per frame a layout moves, where one hands every
// resize of the frame over in a single batch. Keyed by the element, so a delivery finds what to
// write — in one map per box, since the box is an option of `observe` rather than of the observer,
// and the delivery has to know which one the element asked for (32.90).
let observer: ResizeObserver | undefined
const content = new WeakMap<Element, Measured>()
const bordered = new WeakMap<Element, Measured>()
const BORDER_BOX: ResizeObserverOptions = { box: 'border-box' }

/**
 * The `bind:element` callback writing an element's size into `target` as it is laid out.
 *
 * 32.79 — the content box, or 32.90 the border box where `box` says `"border"`; 32.83 — the
 * `Disposer` it hands back stops observing.
 *
 * 32.82 — NOTHING IS READ HERE: a size read at bind time would force the layout the mount just
 * invalidated, and the observer's first delivery, which every observed element is owed, comes
 * after the layout the browser was going to do anyway. The target holds what the author gave it
 * until then.
 *
 * TWO FORMS PER OPTION, because 31.3 holds a name only where its position is a `Reactive`: a
 * position that also took the box itself would hand a `Reactive` box over read, once.
 */
export function size(
    target: Reactive<unknown, Size, unknown, unknown>,
    options?: { box?: Reactive<Box, never, unknown, unknown> },
): (element: Element) => Disposer
export function size(
    target: Reactive<unknown, Size, unknown, unknown>,
    options?: { box?: Box },
): (element: Element) => Disposer
export function size(
    target: (size: Size) => void,
    options?: { box?: Reactive<Box, never, unknown, unknown> },
): (element: Element) => Disposer
export function size(
    target: (size: Size) => void,
    options?: { box?: Box },
): (element: Element) => Disposer
export function size(
    target: unknown,
    options?: { box?: unknown },
): (element: Element) => Disposer {
    const box = options?.box
    return (element) => {
        if (content.has(element) || bordered.has(element))
            observedTwice('size', element)
        observer ??= new ResizeObserver(deliverSizes)
        const measured = new Measured(target)
        // 32.90 — a box that moves observes the element again.
        let stop: Disposer | undefined
        if (isReactive(box))
            stop = watchTracked(() => {
                observeBox(element, measured, (box as () => unknown)())
            })
        else observeBox(element, measured, box)
        return () => {
            stop?.()
            content.delete(element)
            bordered.delete(element)
            ;(observer as ResizeObserver).unobserve(element)
        }
    }
}

// Observing an element again replaces its box, so a box that moves needs no unobserve.
function observeBox(element: Element, measured: Measured, box: unknown): void {
    if (box === 'border') {
        content.delete(element)
        bordered.set(element, measured)
        ;(observer as ResizeObserver).observe(element, BORDER_BOX)
        return
    }
    bordered.delete(element)
    content.set(element, measured)
    ;(observer as ResizeObserver).observe(element)
}

// 32.79 — A FRESH RECORD PER WRITE DEFEATS THE IDENTITY GATE, so a size the target already holds is
// not written: the first delivery of an element whose author seeded its size wakes nobody.
//
// `contentRect` for the content box because its width and height are the physical axes whatever the
// writing mode. The border box has no physical spelling — `borderBoxSize` is inline and block — so
// 32.90's axes are turned by the element's writing mode, a style read made only for a border box,
// after the layout the delivery follows and so never a forced one.
function deliverSizes(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
        let measured = content.get(entry.target)
        let width: number
        let height: number
        if (measured !== undefined) ({ width, height } = entry.contentRect)
        else {
            measured = bordered.get(entry.target)
            if (measured === undefined) continue
            const borderBox = entry.borderBoxSize[0] as ResizeObserverSize
            const writingMode = getComputedStyle(entry.target).writingMode
            if (writingMode === '' || writingMode === 'horizontal-tb') {
                width = borderBox.inlineSize
                height = borderBox.blockSize
            } else {
                width = borderBox.blockSize
                height = borderBox.inlineSize
            }
        }
        const held = measured.held() as
            { width?: unknown; height?: unknown } | null | undefined
        if (held?.width === width && held.height === height) continue
        measured.write({ width, height })
    }
}
