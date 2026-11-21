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
 * The `bind:element` adaptor showing the element in the top layer, placed against `anchor` and
 * placed again as anything moves it, until it is unbound.
 *
 * @param anchor the element it opens against
 * @param options the side it opens on, the edge it lines up with, and the gaps it keeps
 */
export function popover(
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
