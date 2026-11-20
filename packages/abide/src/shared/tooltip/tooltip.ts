// 50.23-50.25, 50.47 — A HINT FOR THE ELEMENT IT IS BOUND TO, shown by the `Tooltips` the layout renders:
// nothing is added beside the anchor, and one popover serves every hint on the page.

import { stack } from '../dismissible.ts'
import { namedLogger } from '../log.ts'
import type { Disposer } from '../reactive/watch.ts'
import { type Hint, hosts, shown, type TooltipOptions } from './tips.ts'

const TOOLTIP_LOG = namedLogger('abide:tooltip')
let warned = false
// 50.25 — THE OPEN HINT'S LAYER on `dismissible`'s stack: one, since one hint shows at a time, so a
// hint another replaces leaves nothing behind to take the next Escape.
let unstack: Disposer | undefined

/**
 * The `bind:element` adaptor opening `hint` against the element once a pointer has rested on it for
 * `delay` milliseconds, and at once when it takes focus the browser shows (`:focus-visible`) — or,
 * given `trigger: 'bound'`, at once and for as long as it is bound.
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

        const isOpen = (): boolean => shown.peek()?.anchor === anchor
        const show = (): void => {
            clearTimeout(timer)
            if (isOpen()) return
            if (hosts.peek()?.length === 0 && !warned) {
                warned = true
                TOOLTIP_LOG.warning(
                    'a hint opened with no <Tooltips /> rendered to show it — render one in the root layout. RULEBOOK 50.36.',
                )
            }
            unstack?.()
            shown.set({ anchor, hint, options })
            // An Escape closes the hint alone, not the panel or the dialog under it; a press passes over it.
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
            if (!isOpen()) return
            unstack?.()
            unstack = undefined
            shown.set(undefined)
        }
        // 50.24 — a click focuses a button too, and a hint opened by it would stand until focus moved.
        const focused = (event: Event): void => {
            if ((event.target as Element).matches(':focus-visible')) show()
        }
        const linger = (): void => {
            clearTimeout(timer)
            timer = setTimeout(show, delay)
        }

        // 50.47 — bound is open: nothing on the anchor opens or closes it but Escape and the unbinding.
        const hovers = options.trigger !== 'bound'
        if (hovers) {
            anchor.addEventListener('mouseenter', linger)
            anchor.addEventListener('mouseleave', hide)
            anchor.addEventListener('focusin', focused)
            anchor.addEventListener('focusout', hide)
        } else show()
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
