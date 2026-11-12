import { heldValue, writeBound } from '#shared/boundValue.ts'

import type { Scope } from './Scope.ts'

// 32.82 — ONE OBSERVER FOR EVERY `bind:size` IN THE DOCUMENT, made by the first and kept: an observer
// per element is a callback per element per frame a layout moves, where one hands every resize of
// the frame over in a single batch. Keyed by the element, so a delivery finds the operand to write —
// in one map per box, since the box is an option of `observe` rather than of the observer, and the
// delivery has to know which one the element asked for (32.92).
let observer: ResizeObserver | undefined
const operands = new WeakMap<Element, unknown>()
const bordered = new WeakMap<Element, unknown>()
const BORDER_BOX: ResizeObserverOptions = { box: 'border-box' }

/**
 * 32.79 — writes an element's content-box size, or 32.92 its border-box size where its `sizeBox`
 * says `"border"`, into its `bind:size` value as it is laid out, and
 * 32.85 — stops observing it at the scope's teardown.
 *
 * 32.83 — NOTHING IS READ HERE: a size read at bind time would force the layout the mount just
 * invalidated, and the observer's first delivery, which every observed element is owed, comes
 * after the layout the browser was going to do anyway. The value holds what the author gave it
 * until then.
 *
 * `box` is the compiled `sizeBox`: the string a static one says, a thunk watched for an expression,
 * and absent where the tag has none.
 */
export function bindSize(
    element: Element,
    operand: unknown,
    scope: Scope,
    box?: string | (() => string),
): void {
    observer ??= new ResizeObserver(deliverSizes)
    if (typeof box === 'function')
        scope.watch(() => observeBox(element, operand, box()))
    else observeBox(element, operand, box)
    scope.stops.push(() => {
        operands.delete(element)
        bordered.delete(element)
        ;(observer as ResizeObserver).unobserve(element)
    })
}

// Observing an element again replaces its box, so a `sizeBox` that moves needs no unobserve.
function observeBox(
    element: Element,
    operand: unknown,
    box: string | undefined,
): void {
    if (box === 'border') {
        operands.delete(element)
        bordered.set(element, operand)
        ;(observer as ResizeObserver).observe(element, BORDER_BOX)
        return
    }
    bordered.delete(element)
    operands.set(element, operand)
    ;(observer as ResizeObserver).observe(element)
}

// 32.79 — A FRESH RECORD PER WRITE DEFEATS THE IDENTITY GATE, so a size the value already holds is not
// written: the first delivery of an element whose author seeded its size wakes nobody.
//
// `contentRect` for the content box because its width and height are the physical axes whatever the
// writing mode. The border box has no physical spelling — `borderBoxSize` is inline and block — so
// 32.92's axes are turned by the element's writing mode, a style read made only for a border box,
// after the layout the delivery follows and so never a forced one.
function deliverSizes(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
        let operand = operands.get(entry.target)
        let width: number
        let height: number
        if (operand !== undefined) ({ width, height } = entry.contentRect)
        else {
            operand = bordered.get(entry.target)
            if (operand === undefined) continue
            const size = entry.borderBoxSize[0] as ResizeObserverSize
            const writingMode = getComputedStyle(entry.target).writingMode
            if (writingMode === '' || writingMode === 'horizontal-tb') {
                width = size.inlineSize
                height = size.blockSize
            } else {
                width = size.blockSize
                height = size.inlineSize
            }
        }
        const held = heldValue(operand) as
            { width?: unknown; height?: unknown } | null | undefined
        if (held?.width === width && held.height === height) continue
        writeBound(operand, { width, height })
    }
}
