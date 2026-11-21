// 50.23, 50.36 — THE ONE HINT SHOWING, which the `tooltip.host` standing in the page shows. Written only
// in a browser — `tooltip.tip` is a `bind:element` adaptor, which a server never runs.

import { outlet } from '../outlet.ts'
import type { Side } from '../place.ts'
import type { PopoverOptions } from '../popover.ts'
import { reactive } from '../reactive/index.ts'

/**
 * Where a hint opens against its anchor — `popover`'s placement, every option of it, so the two cannot
 * drift — and how long a pointer rests first. Only the side's default is a hint's own.
 */
export type TooltipOptions = Omit<PopoverOptions, 'side'> & {
    /** The side of the anchor the hint opens on, flipped to the opposite one where it has no room. Default `'top'`. */
    side?: Side
    /** Milliseconds a pointer rests on the anchor before the hint opens. Default `300`. */
    delay?: number
}

/** The hint open: its text, the anchor it is open against, and where it opens. */
export type OpenTip = {
    anchor: Element
    text: string
    options: TooltipOptions
}

export const shown = reactive<OpenTip | undefined>(undefined)

// 50.36 — the hosts standing: the last shows the hint.
export const hints = outlet('<Tooltips />', 'abide:tooltip')
