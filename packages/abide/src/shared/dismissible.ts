// 53.12-53.16 — A PANEL CLOSED FROM OUTSIDE IT. Every element bound is a layer on one stack, and the
// document is listened to only while the stack holds one: a page with no panel open pays nothing.
//
// WHO TAKES AN ESCAPE, innermost first and one per keypress: the FOCUSED element, whose own `keydown`
// runs before the document's — an open `menu`'s items (50.31), a `Combobox`'s input (51.27, 51.28) —
// keeps it with `preventDefault`; then this stack from the top, an open hint among its layers (50.25);
// then a native `<dialog>` or an `auto` popover, whose close request an Escape anyone prevented never
// makes. A menu stays off the stack because focus is inside it for as long as it is open — Tab and a
// press outside close it as the browser light-dismisses an `auto` popover — so its own handler is
// already the innermost one.

import { reactive } from './reactive/index.ts'
import type { Disposer } from './reactive/watch.ts'
import { register } from './register.ts'

/** An element `dismissible` is bound to, in the order they were bound: the last is on top. */
type Layer = {
    element: Element
    dismiss: (event: PointerEvent | KeyboardEvent) => void
    escape: boolean
    outside: boolean
    inside: readonly (Element | null | undefined)[]
}

const layers = reactive<readonly Layer[]>([])

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
        return stack({
            element,
            dismiss: onDismiss,
            escape: options.escape ?? true,
            outside: options.outside ?? true,
            inside: options.inside ?? [],
        })
    }
}

/** Puts `layer` on top of the stack, and hands back what takes it off. */
function stack(layer: Layer): Disposer {
    if (layers.peek()?.length === 0) {
        // CAPTURE, so a press an inner handler stops still reaches here.
        document.addEventListener('pointerdown', pressed, true)
        document.addEventListener('keydown', escaped)
    }
    const unregister = register(layers, layer)
    return () => {
        unregister()
        if ((layers.peek()?.length ?? 0) > 0) return
        document.removeEventListener('pointerdown', pressed, true)
        document.removeEventListener('keydown', escaped)
    }
}

// 53.15 — from the top, until the layer the press lands in. A layer `outside` is off for is passed
// over rather than ending the walk, as Escape passes a layer `escape` is off for. A layer dismissed
// here may take itself off the stack as it closes, and the walk reads the list as it stood: a
// layer leaving writes a new one rather than changing this.
function pressed(event: PointerEvent): void {
    const target = event.target as Node | null
    const stacked = layers.peek() ?? []
    for (let at = stacked.length - 1; at >= 0; at--) {
        const layer = stacked[at] as Layer
        if (target !== null && holds(layer, target)) return
        if (layer.outside) layer.dismiss(event)
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
    const stacked = layers.peek() ?? []
    for (let at = stacked.length - 1; at >= 0; at--) {
        const layer = stacked[at] as Layer
        if (!layer.escape) continue
        event.preventDefault()
        layer.dismiss(event)
        return
    }
}
