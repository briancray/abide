// 50.55, 50.56, 50.75, 50.76 — WHAT OPENS A LAYER BESIDE A PRESS: a mouse or a pen resting on what it
// is anchored to, and focus the browser shows landing there; and what closes it again, a leave for what
// a pointer opened and a blur for what focus opened. `popover` lays it on its trigger, its anchor and
// itself, and `tooltip.tip` on its anchor, whose hint the pointer passes through (50.47).

import { type Live, live } from './live.ts'

/** 50.55, 50.56, 50.75 — what opens a layer besides a press, and what closes one a pointer opened. */
export type HoverAndFocusOptions = {
    /** 50.55 — milliseconds a mouse or a pen rests on the trigger or the anchor before it opens, or `false` for never. Off by default; a function is read live. */
    openOnHover?: Live<number | false>
    /** 50.56 — milliseconds after the pointer leaves the trigger or the anchor and the layer before one a pointer opened closes, or `false` for never. Off by default; a function is read live. */
    closeOnLeave?: Live<number | false>
    /** 50.75 — whether it opens at once when the trigger or the anchor takes focus the browser shows. Off by default; a function is read live. */
    openOnFocus?: Live<boolean>
}

/** How an open layer was opened, where it matters to what closes it: a pointer resting, a pointer's press, or focus. */
export type OpenedBy = 'hover' | 'press' | 'focus'

/**
 * The listeners opening the layer `layer` stands for on a rest and on focus, and closing it on a leave
 * and a blur: `enter` and `leave` for the anchor's and the layer's pointer, `focused` for the anchor's
 * `focusin`, `blurred` for either's `focusout`, and `stop` clearing what is pending as it closes.
 */
export function hoverAndFocus(
    options: HoverAndFocusOptions,
    layer: {
        /** Whether it is open. */
        isOpen(): boolean
        /** How it was opened, or `undefined` where it is shut or was opened another way. */
        openedBy(): OpenedBy | undefined
        show(by: 'hover' | 'focus'): void
        hide(): void
        /** The elements focus moving into keeps a layer focus opened. */
        inside(): readonly (Element | null)[]
    },
) {
    let opening: ReturnType<typeof setTimeout> | undefined
    let closing: ReturnType<typeof setTimeout> | undefined
    const stop = (): void => {
        clearTimeout(opening)
        clearTimeout(closing)
        opening = closing = undefined
    }
    return {
        // 50.55 — a touch has no hover, and a tap is a click.
        enter: (event: PointerEvent) => {
            clearTimeout(closing)
            if (event.pointerType === 'touch' || layer.isOpen()) return
            const after = live(options.openOnHover)
            if (after === undefined || after === false) return
            clearTimeout(opening)
            opening = setTimeout(() => layer.show('hover'), after)
        },
        // 50.56 — what a key, focus or the app opened stays for a leave.
        leave: () => {
            clearTimeout(opening)
            const by = layer.openedBy()
            if (by !== 'hover' && by !== 'press') return
            const after = live(options.closeOnLeave)
            if (after === undefined || after === false) return
            clearTimeout(closing)
            if (after === 0) layer.hide()
            else closing = setTimeout(layer.hide, after)
        },
        // 50.75 — a click focuses a button too, and a layer opened by it would stand until focus moved.
        focused: (event: FocusEvent) => {
            if (!live(options.openOnFocus) || layer.isOpen()) return
            if ((event.target as Element).matches(':focus-visible'))
                layer.show('focus')
        },
        // 50.76
        blurred: (event: FocusEvent) => {
            if (layer.openedBy() !== 'focus') return
            const to = event.relatedTarget
            if (to instanceof Node)
                for (const element of layer.inside())
                    if (element?.contains(to)) return
            layer.hide()
        },
        stop,
    }
}
