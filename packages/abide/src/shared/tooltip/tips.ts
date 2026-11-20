// 50.23, 50.36 — THE ONE HINT SHOWING, which the `Tooltips` standing in the page renders. Written only in a
// browser — `tooltip` is a `bind:element` adaptor, which a server never runs.

import { outlet } from '../outlet.ts'
import type { Side } from '../place.ts'
import { reactive } from '../reactive/index.ts'

/** What a hint shows: text, or a component rendered with no props. */
export type Hint = string | ((props: Record<string, never>) => unknown)

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

/** The hint open, the anchor it is open against, where it opens, and the element it describes. */
export type OpenTip = {
    anchor: Element
    hint: Hint
    options: TooltipOptions
    /** The anchor, save a `Chart`'s readout, which is placed against its crosshair and describes the chart (50.47). */
    describes: Element
}

export const shown = reactive<OpenTip | undefined>(undefined)

// 50.36 — the `Tooltips` standing: the last renders the hint.
export const hints = outlet('<Tooltips />', 'abide:tooltip')
