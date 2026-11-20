// 50.23-50.25, 50.47 — A HINT FOR AN ELEMENT, shown by the `Tooltips` the layout renders:
// nothing is added beside the anchor, and one popover serves every hint on the page.

import { stack } from '../dismissible.ts'
import type { Disposer } from '../reactive/watch.ts'
import {
    type Hint,
    hints,
    type OpenTip,
    shown,
    type TooltipOptions,
} from './tips.ts'

// 50.25 — THE OPEN HINT'S LAYER on `dismissible`'s stack: one, since one hint shows at a time, so a
// hint another replaces leaves nothing behind to take the next Escape.
let unstack: Disposer | undefined

/**
 * 50.36, 50.47 — Shows `hint` in the `Tooltips` standing, against `anchor`, until what it hands back
 * runs: what `tooltip` opens on a pointer resting or on focus, and what a `Chart`'s readout opens for
 * as long as its crosshair stands. An Escape no one prevented calls `dismiss`; a press passes over it.
 * `describes` is the element the hint describes while it shows (50.23).
 */
export function openHint(
    anchor: Element,
    hint: Hint,
    options: TooltipOptions,
    dismiss: () => void,
    describes: Element = anchor,
): Disposer {
    hints.asked()
    unstack?.()
    const open: OpenTip = { anchor, hint, options, describes }
    shown.set(open)
    unstack = stack({
        element: anchor,
        dismiss,
        escape: true,
        outside: false,
        inside: [],
    })
    return () => {
        if (shown.peek() !== open) return
        unstack?.()
        unstack = undefined
        shown.set(undefined)
    }
}

/**
 * The `bind:element` adaptor opening `hint` against the element once a pointer has rested on it for
 * `delay` milliseconds, and at once when it takes focus the browser shows (`:focus-visible`).
 *
 * @param hint the text, or a component rendered with no props
 * @param options where it opens, and how long a pointer rests first
 */
export function tooltip(
    hint: Hint,
    options: TooltipOptions = {},
): (anchor: Element) => Disposer {
    const delay = options.delay ?? 300
    return (anchor) => {
        // 50.23 — text describes its anchor with no element to point at; a component is pointed at
        // by `Tooltips` while it is open.
        const description = anchor.getAttribute('aria-description')
        if (typeof hint === 'string')
            anchor.setAttribute('aria-description', hint)
        let timer: ReturnType<typeof setTimeout> | undefined
        let close: Disposer | undefined

        const show = (): void => {
            clearTimeout(timer)
            if (shown.peek()?.anchor === anchor) return
            close = openHint(anchor, hint, options, hide)
        }
        function hide(): void {
            clearTimeout(timer)
            close?.()
            close = undefined
        }
        // 50.24 — a click focuses a button too, and a hint opened by it would stand until focus moved.
        const focused = (event: Event): void => {
            if ((event.target as Element).matches(':focus-visible')) show()
        }
        // THE TRIGGER IS THE HINT'S OWN: a pointer resting and focus the browser shows open nothing else
        // abide ships — a `menu` opens on a press the popover toggles and on the arrows `openingEnd`
        // names, a `Combobox` on those arrows and on typing — so there is no second caller to share it.
        const linger = (): void => {
            clearTimeout(timer)
            timer = setTimeout(show, delay)
        }

        anchor.addEventListener('mouseenter', linger)
        anchor.addEventListener('mouseleave', hide)
        anchor.addEventListener('focusin', focused)
        anchor.addEventListener('focusout', hide)
        return () => {
            hide()
            anchor.removeEventListener('mouseenter', linger)
            anchor.removeEventListener('mouseleave', hide)
            anchor.removeEventListener('focusin', focused)
            anchor.removeEventListener('focusout', hide)
            if (typeof hint !== 'string') return
            if (description === null) anchor.removeAttribute('aria-description')
            else anchor.setAttribute('aria-description', description)
        }
    }
}
