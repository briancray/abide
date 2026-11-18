// 53.12-53.16 — A PANEL CLOSED FROM OUTSIDE IT. Every element bound is a layer on one stack, and the
// document is listened to only while the stack holds one: a page with no panel open pays nothing.

import type { Disposer } from './reactive/watch.ts'

/** An element `dismissible` is bound to, in the order they were bound: the last is on top. */
type Layer = {
    element: Element
    dismiss: (event: PointerEvent | KeyboardEvent) => void
    escape: boolean
    outside: boolean
    inside: readonly (Element | null | undefined)[]
}

const layers: Layer[] = []

/**
 * The `bind:element` adaptor calling `onDismiss` on a press outside the element or on Escape.
 *
 * Bound to several elements at once — a menu opened from a panel — they stack: Escape dismisses the
 * last one bound, and a press dismisses each one from the top that it lands outside, stopping at
 * the first it lands in. The press that opened the element is over by the time it is bound, so it
 * dismisses nothing.
 *
 * @param onDismiss what closes the element, handed the `pointerdown` or `keydown` that asked
 * @param options which of the two dismiss, and what else a press counts as inside
 */
export function dismissible(
    onDismiss: (event: PointerEvent | KeyboardEvent) => void,
    options: {
        /** Whether Escape dismisses. `true` by default. */
        escape?: boolean
        /** Whether a press outside the element dismisses. `true` by default. */
        outside?: boolean
        /**
         * Elements a press on is not outside, besides the element itself: the button that opens it,
         * so pressing that button again is the button's to answer. An entry still `undefined` is
         * skipped.
         */
        inside?: readonly (Element | null | undefined)[]
    } = {},
): (element: Element) => Disposer {
    return (element) => {
        const layer: Layer = {
            element,
            dismiss: onDismiss,
            escape: options.escape ?? true,
            outside: options.outside ?? true,
            inside: options.inside ?? [],
        }
        if (layers.length === 0) {
            // CAPTURE, so a press an inner handler stops still reaches here.
            document.addEventListener('pointerdown', pressed, true)
            document.addEventListener('keydown', escaped)
        }
        layers.push(layer)
        return () => {
            const at = layers.indexOf(layer)
            if (at !== -1) layers.splice(at, 1)
            if (layers.length > 0) return
            document.removeEventListener('pointerdown', pressed, true)
            document.removeEventListener('keydown', escaped)
        }
    }
}

// 53.15 — from the top, until the layer the press lands in. A layer dismissed here may take itself
// off the stack as it closes, so the walk reads a copy.
function pressed(event: PointerEvent): void {
    const target = event.target as Node | null
    const stacked = layers.slice()
    for (let at = stacked.length - 1; at >= 0; at--) {
        const layer = stacked[at] as Layer
        if (target !== null && holds(layer, target)) return
        if (!layer.outside) return
        layer.dismiss(event)
    }
}

function holds(layer: Layer, target: Node): boolean {
    if (layer.element.contains(target)) return true
    for (const element of layer.inside)
        if (element?.contains(target)) return true
    return false
}

// 53.14 — bubbling, so a field or a list inside the element that takes Escape for itself, and says
// so with `preventDefault`, keeps it.
function escaped(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing)
        return
    for (let at = layers.length - 1; at >= 0; at--) {
        const layer = layers[at] as Layer
        if (!layer.escape) continue
        event.preventDefault()
        layer.dismiss(event)
        return
    }
}
