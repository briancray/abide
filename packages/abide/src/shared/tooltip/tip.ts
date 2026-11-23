// 50.23-50.25 — A TEXT HINT FOR THE ELEMENT IT IS BOUND TO, shown by the `tooltip.host` standing in
// the page: nothing is added beside the anchor, and one popover serves every hint on the page.

import { dismissing } from '../dismissible.ts'
import { live } from '../live.ts'
import type { Disposer } from '../reactive/watch.ts'
import { hints, type OpenTip, shown, type TooltipOptions } from './tips.ts'

// 50.25 — THE OPEN HINT'S LAYER on `dismissible`'s stack: one, since one hint shows at a time, so a
// hint another replaces leaves nothing behind to take the next Escape.
let unstack: Disposer | undefined

/**
 * The part opening `text` against the element it is spread on once a pointer has rested on it for
 * `delay` milliseconds, and at once when it takes focus the browser shows (`:focus-visible`). The
 * text describes the element from the server's markup on (50.23).
 *
 * @param text what the hint says, and what describes the element
 * @param options where it opens, and how long a pointer rests first
 */
export function tip(
    text: string,
    options: TooltipOptions = {},
): Record<string, unknown> {
    // 50.23 — the text describes its anchor with no element to point at.
    return {
        'aria-description': text,
        'data-tooltip': 'anchor',
        'bind:element': tipAgainst(text, options, undefined),
    }
}

/**
 * `tip`, opening against `box` rather than the element's own box where one is given: what `pie` binds
 * a slice's hint with, its element being the whole ring (52.67). Not `tip`'s own option, so it is no
 * name an app writes. The binding alone: the part it is spread in writes the `aria-description`
 * (50.23), so the server writes it and an explicit one beats it (33.12).
 */
export function tipAgainst(
    text: string,
    options: TooltipOptions,
    box: ((anchor: Element) => DOMRect) | undefined,
): (anchor: Element) => Disposer {
    return (anchor) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        let open: OpenTip | undefined

        const show = (): void => {
            clearTimeout(timer)
            if (open !== undefined && shown.peek() === open) return
            hints.asked()
            unstack?.()
            open = { anchor, text, options, box }
            shown.set(open)
            unstack = dismissing(hide, { outside: false })(anchor)
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
            timer = setTimeout(show, live(options.delay) ?? 300)
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
        }
    }
}
