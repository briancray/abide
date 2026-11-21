// 50.23, 50.36 — THE ONE HINT SHOWING, which the `tooltip.host` standing in the page shows. Written only
// in a browser — `tooltip.tip` is a `bind:element` adaptor, which a server never runs.

import { outlet } from '../outlet.ts'
import type { Side } from '../place.ts'
import { reactive } from '../reactive/index.ts'

/** Where a hint opens against its anchor, and how long a pointer rests first. */
export type TooltipOptions = {
    /** The side of the anchor the hint opens on, flipped to the opposite one where it has no room. Default `'top'`. */
    side?: Side
    /** Which edge of the anchor the hint lines up with. Default `'center'`. */
    align?: 'start' | 'center' | 'end'
    /** Pixels between the anchor and the hint. Default `8`. */
    offset?: number
    /** Pixels the arrow's `--arrow-offset` keeps from each end of the hint's facing edge. Default `0`. */
    arrowInset?: number
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
