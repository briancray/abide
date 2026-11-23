// 53.12-53.16 — A PANEL CLOSED FROM OUTSIDE IT. Every element bound is a layer on one stack, and the
// document is listened to only while the stack holds one: a page with no panel open pays nothing.
//
// WHO TAKES AN ESCAPE, innermost first and one per keypress: the FOCUSED element, whose own `keydown`
// runs before the document's — a `menu`'s items (50.31), a `Combobox`'s input (51.27, 51.28) —
// keeps it with `preventDefault`; then this stack from the top, an open `popover` or hint among its
// layers (50.25, 50.60); then a native `<dialog>`, whose close request an Escape anyone prevented never
// makes.

import { reactive } from './reactive/index.ts'
import type { Disposer } from './reactive/watch.ts'
import { register } from './register.ts'

/** An element `dismissible` is bound to, in the order they were bound: the last is on top. */
type Layer = {
    element: Element
    dismiss: (event: PointerEvent | KeyboardEvent) => void
    escape: boolean
    outside: boolean
    inside: Iterable<Element | null | undefined>
}

const layers = reactive<readonly Layer[]>([])

/** Which of a press outside and an Escape dismiss: `dismissible`'s options. */
export type DismissibleOptions = {
    /** Whether Escape dismisses. `true` by default. */
    escape?: boolean
    /** Whether a press outside the element dismisses. `true` by default. */
    outside?: boolean
}

/** The two parts `dismissible` hands back: `<form {...edit.host}>`, `<button {...edit.inside}>`. */
export type DismissibleParts = {
    /** The element a press outside or an Escape closes. */
    readonly host: Record<string, unknown>
    /**
     * An element a press on is not outside, spread on as many as there are: the button that opens
     * the host, so pressing it again is the button's to answer.
     */
    readonly inside: Record<string, unknown>
}

/**
 * The parts calling `onDismiss` on a press outside the host, or on Escape.
 *
 * Several hosts standing at once — a menu opened from a panel — stack: Escape dismisses the last one
 * bound, and a press dismisses each one from the top that it lands outside, stopping at the first it
 * lands in. The press that opened the host is over by the time it is bound, so it dismisses nothing.
 *
 * @param onDismiss what closes the host, handed the `pointerdown` or `keydown` that asked
 * @param options which of the two dismiss
 */
export function dismissible(
    onDismiss: (event: PointerEvent | KeyboardEvent) => void,
    options: DismissibleOptions = {},
): DismissibleParts {
    const inside = new Set<Element>()
    return {
        host: {
            'data-dismissible': 'host',
            'bind:element': dismissing(onDismiss, { ...options, inside }),
        },
        inside: {
            'data-dismissible': 'inside',
            'bind:element': (element: Element): Disposer => {
                inside.add(element)
                return () => {
                    inside.delete(element)
                }
            },
        },
    }
}

/**
 * `dismissible`'s binding alone, for a part of the framework's own that stacks an element it holds,
 * with what else a press counts as inside — read at each press, so a set filled later counts.
 */
export function dismissing(
    onDismiss: (event: PointerEvent | KeyboardEvent) => void,
    options: DismissibleOptions & {
        inside?: Iterable<Element | null | undefined>
    } = {},
): (element: Element) => Disposer {
    return (element) =>
        stack({
            element,
            dismiss: onDismiss,
            escape: options.escape ?? true,
            outside: options.outside ?? true,
            inside: options.inside ?? [],
        })
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
