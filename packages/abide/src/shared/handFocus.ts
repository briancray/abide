// 49.15 — A BUTTON ITS OWN CLICK DISABLES WOULD DROP FOCUS TO THE PAGE, and the keys of whatever held it
// go unheard. The parts that step to an end hand it on instead, to what their clause names.

/** Moves focus to what `to` finds where `pressed` held it and its click has just disabled it. */
export function handFocus(
    pressed: EventTarget | null | undefined,
    disabled: boolean,
    to: () => HTMLElement | null | undefined,
): void {
    if (!disabled || pressed == null) return
    if (pressed !== globalThis.document?.activeElement) return
    to()?.focus()
}

/** The element matching `selector` nearest `from`: in its parent, then its parent's parent, outward. */
export function nearest(
    from: EventTarget | null | undefined,
    selector: string,
): HTMLElement | null {
    let around = (from as Element | null | undefined)?.parentElement ?? null
    while (around !== null) {
        const found = around.querySelector<HTMLElement>(selector)
        if (found !== null) return found
        around = around.parentElement
    }
    return null
}
