// 50.19-50.22, 50.26, 50.27, 50.49 — AN APP'S OWN OVERLAY HELD AGAINST AN ANCHOR: the anchored layer `Tooltips` and
// `menu` open in, bound to an element of the app's. Open for exactly as long as it is bound, so an
// `{#if}` around the element is what opens and closes it, and closing it from outside or on Escape is
// `dismissible`'s, bound beside it.

import { anchored } from './anchored.ts'
import type { PlaceOptions } from './place.ts'
import type { Disposer } from './reactive/watch.ts'

/** 50.19-50.21, 50.35 — the side a popover opens on, the edge it lines up with, and the gaps it keeps. */
export type PopoverOptions = PlaceOptions

/**
 * The part showing the element it is spread on in the top layer, placed against `anchor` and placed
 * again as anything moves it, until it is unbound. The server writes it a manual popover, so it is
 * hidden from the first paint; a `popover` the element writes itself is its own (33.12).
 *
 * @param anchor the element it opens against — not there yet on the server, where nothing opens
 * @param options the side it opens on, the edge it lines up with, and the gaps it keeps
 */
export function popover(
    anchor: Element | undefined,
    options: PopoverOptions = {},
): Record<string, unknown> {
    return {
        popover: 'manual',
        'data-popover': 'host',
        'bind:element': (element: Element) =>
            anchor === undefined
                ? undefined
                : popoverOn(anchor, options)(element),
    }
}

/** `popover`'s binding alone, for a part of the framework's own that opens an element it holds. */
export function popoverOn(
    anchor: Element,
    options: PopoverOptions = {},
): (element: Element) => Disposer {
    return (element) => {
        const floating = element as HTMLElement
        // 50.49 — a manual popover, which no press elsewhere and no other popover closes: what opens
        // and closes it is the binding.
        if (!floating.hasAttribute('popover'))
            floating.setAttribute('popover', 'manual')
        return anchored(anchor, floating, options, (placement) =>
            floating.setAttribute('data-side', placement.side),
        )
    }
}
