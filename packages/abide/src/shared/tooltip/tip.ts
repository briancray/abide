// 50.23-50.25 — A TEXT HINT FOR THE ELEMENT IT IS BOUND TO, shown by the `tooltip.host` standing in
// the page: nothing is added beside the anchor, and one popover serves every hint on the page.

import { stack } from '../dismissible.ts'
import type { Disposer } from '../reactive/watch.ts'
import { hints, type OpenTip, shown, type TooltipOptions } from './tips.ts'

// 50.25 — THE OPEN HINT'S LAYER on `dismissible`'s stack: one, since one hint shows at a time, so a
// hint another replaces leaves nothing behind to take the next Escape.
let unstack: Disposer | undefined

/**
 * The `bind:element` adaptor opening `text` against the element once a pointer has rested on it for
 * `delay` milliseconds, and at once when it takes focus the browser shows (`:focus-visible`).
 *
 * @param text what the hint says, and what describes the element
 * @param options where it opens, and how long a pointer rests first
 */
export function tip(
    text: string,
    options: TooltipOptions = {},
): (anchor: Element) => Disposer {
    const delay = options.delay ?? 300
    return (anchor) => {
        // 50.23 — the text describes its anchor with no element to point at.
        const description = anchor.getAttribute('aria-description')
        anchor.setAttribute('aria-description', text)
        let timer: ReturnType<typeof setTimeout> | undefined
        let open: OpenTip | undefined

        const show = (): void => {
            clearTimeout(timer)
            if (open !== undefined && shown.peek() === open) return
            hints.asked()
            unstack?.()
            open = { anchor, text, options }
            shown.set(open)
            unstack = stack({
                element: anchor,
                dismiss: hide,
                escape: true,
                outside: false,
                inside: [],
            })
        }
        function hide(): void {
            clearTimeout(timer)
            if (open === undefined || shown.peek() !== open) return
            open = undefined
            unstack?.()
            unstack = undefined
            shown.set(undefined)
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
            if (description === null) anchor.removeAttribute('aria-description')
            else anchor.setAttribute('aria-description', description)
        }
    }
}
