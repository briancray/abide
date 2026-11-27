// 50.23-50.25 — A MARKDOWN HINT FOR THE ELEMENT IT IS BOUND TO, shown by the `tooltip.host` standing
// in the page: nothing is added beside the anchor, and one popover serves every hint on the page.

import { dismissing } from '../dismissible.ts'
import { hoverAndFocus, type OpenedBy } from '../hoverAndFocus.ts'
import { live } from '../live.ts'
import type { Disposer } from '../reactive/watch.ts'
import { hintHtml, hintText } from './hint.ts'
import { hints, type OpenTip, shown, type TooltipOptions } from './tips.ts'

// 50.25 — THE OPEN HINT'S LAYER on `dismissible`'s stack: one, since one hint shows at a time, so a
// hint another replaces leaves nothing behind to take the next Escape.
let unstack: Disposer | undefined

/**
 * The part opening `text` against the element it is spread on once a mouse or a pen has rested on it
 * for `delay` milliseconds, and at once when it takes focus the browser shows (`:focus-visible`). The
 * text is markdown (50.86), and its plain text describes the element from the server's markup on
 * (50.23, 50.87).
 *
 * @param text what the hint says, as markdown, and what describes the element
 * @param options where it opens, and how long a pointer rests first
 */
export function tip(
    text: string,
    options: TooltipOptions = {},
): Record<string, unknown> {
    // 50.23 — the text describes its anchor with no element to point at.
    return {
        'aria-description': hintText(hintHtml(text)),
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
        let open: OpenTip | undefined
        // How the hint showing was opened: a leave closes what a rest opened, a blur what focus did.
        let openedBy: OpenedBy | undefined
        const showing = (): boolean =>
            open !== undefined && shown.peek() === open

        const show = (by: OpenedBy): void => {
            if (showing()) return
            hints.asked()
            unstack?.()
            open = { anchor, text, options, box }
            openedBy = by
            shown.set(open)
            unstack = dismissing(hide, { outside: false })(anchor)
        }
        function hide(): void {
            opens.stop()
            if (!showing()) return
            open = undefined
            unstack?.()
            unstack = undefined
            shown.set(undefined)
        }
        // 50.24, 50.25 — a popover's rest and focus, a leave closing the hint at once.
        const opens = hoverAndFocus(
            {
                openOnHover: () => live(options.delay) ?? 300,
                closeOnLeave: 0,
                openOnFocus: true,
            },
            {
                isOpen: showing,
                openedBy: () => (showing() ? openedBy : undefined),
                show,
                hide,
                inside: () => [anchor],
            },
        )

        // An anchor is any element, an SVG slice's among them, whose event map names none of these.
        const listeners: [string, EventListener][] = [
            ['pointerenter', opens.enter as EventListener],
            ['pointerleave', opens.leave],
            ['focusin', opens.focused as EventListener],
            ['focusout', opens.blurred as EventListener],
        ]
        for (const [name, listener] of listeners)
            anchor.addEventListener(name, listener)
        return () => {
            hide()
            for (const [name, listener] of listeners)
                anchor.removeEventListener(name, listener)
        }
    }
}
