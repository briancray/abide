// 50.19-50.22 — WHERE A FLOATING ELEMENT SITS BESIDE ITS ANCHOR: the placement `Tooltip` and `Menu`
// open at, and one an app's own overlay can take. It READS and never writes (50.22), so a caller
// placing several reads every one before writing any, and one forced layout pays for all of them.

/** A side of the anchor a floating element can sit on. */
export type Side = 'top' | 'bottom' | 'left' | 'right'

/** Where a floating element sits against its anchor, and how it is kept on screen. */
export type PlaceOptions = {
    /** The side tried first; the opposite one is taken where this one has no room and that one has more. Default `'bottom'`. */
    side?: Side
    /** Which edge of the anchor the floating element lines up with along that side: `'start'`, `'center'` or `'end'`. Default `'center'`. */
    align?: 'start' | 'center' | 'end'
    /** Pixels between the anchor and the floating element. Default `8`. */
    offset?: number
    /** Pixels the floating element keeps from the viewport's edges. Default `8`. */
    margin?: number
    /** 50.35 — pixels `arrow` keeps from each end of the floating element's facing edge, so an arrow clears its rounded corners. Default `0`. */
    arrowInset?: number
}

/** Where `place` puts a floating element, in viewport pixels. */
export type Placement = {
    /** The floating element's left edge. */
    x: number
    /** The floating element's top edge. */
    y: number
    /** The side it took, which a flip can change from the one asked for. */
    side: Side
    /** How far along the floating element's facing edge the anchor's middle falls: where an arrow points from. */
    arrow: number
}

const OPPOSITE: Record<Side, Side> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
}

/**
 * Where `floating` sits beside `anchor` in the viewport, for an element positioned `fixed` — the top
 * layer a popover or a modal dialog opens in. It reads layout and writes nothing.
 */
export function place(
    anchor: Element,
    floating: Element,
    options: PlaceOptions = {},
): Placement {
    const { align = 'center', offset = 8, margin = 8, arrowInset = 0 } = options
    const at = anchor.getBoundingClientRect()
    const size = floating.getBoundingClientRect()
    const viewport = document.documentElement
    const width = viewport.clientWidth
    const height = viewport.clientHeight

    let side = options.side ?? 'bottom'
    const opposite = OPPOSITE[side]
    const needed =
        side === 'top' || side === 'bottom' ? size.height : size.width
    const roomOnSide = room(side, at, width, height, offset + margin)
    if (
        roomOnSide < needed &&
        room(opposite, at, width, height, offset + margin) > roomOnSide
    )
        side = opposite

    const vertical = side === 'top' || side === 'bottom'
    const main = vertical
        ? side === 'top'
            ? at.top - offset - size.height
            : at.bottom + offset
        : side === 'left'
          ? at.left - offset - size.width
          : at.right + offset
    const start = vertical ? at.left : at.top
    const length = vertical ? at.width : at.height
    const extent = vertical ? size.width : size.height
    const cross =
        align === 'start'
            ? start
            : align === 'end'
              ? start + length - extent
              : start + length / 2 - extent / 2

    const x = clamp(
        vertical ? cross : main,
        margin,
        width - size.width - margin,
    )
    const y = clamp(
        vertical ? main : cross,
        margin,
        height - size.height - margin,
    )
    return {
        x,
        y,
        side,
        // An edge shorter than both insets puts the arrow at its middle.
        arrow:
            extent < 2 * arrowInset
                ? extent / 2
                : clamp(
                      start + length / 2 - (vertical ? x : y),
                      arrowInset,
                      extent - arrowInset,
                  ),
    }
}

/** The room `side` of the anchor leaves in a `width` by `height` viewport, past `gap`. */
function room(
    side: Side,
    at: DOMRect,
    width: number,
    height: number,
    gap: number,
): number {
    if (side === 'top') return at.top - gap
    if (side === 'bottom') return height - at.bottom - gap
    if (side === 'left') return at.left - gap
    return width - at.right - gap
}

// Kept inside [low, high]; where the element is wider than the room, its start edge wins (50.21).
function clamp(value: number, low: number, high: number): number {
    return Math.max(low, Math.min(value, high))
}
