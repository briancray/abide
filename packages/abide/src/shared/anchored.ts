// 50.26, 50.27, 50.48 — A POPOVER HELD AGAINST ITS ANCHOR: shown in the top layer, placed by `place`,
// and placed again whenever anything could have moved it, until it is let go. What `Tooltips`, `menu`
// and `popover` are built on; an app reaches it through `popover`.

import { resized } from './observe/resized.ts'
import { place, type Placement, type PlaceOptions } from './place.ts'

/** Where an anchored popover sits, and whether it takes the pointer. */
export type AnchoredOptions = PlaceOptions & {
    /** 50.48 — `false` for a layer the pointer passes through, as a hint is. Default `true`. */
    interactive?: boolean
}

/**
 * Shows `floating` — a `popover` — and places it against `anchor` now, and again in the frame after
 * anything scrolls, the window resizes, or either of the two changes size, until the stop it hands
 * back is called, which hides it if it is still open. `placed` is told each placement.
 */
export function anchored(
    anchor: Element,
    floating: HTMLElement,
    options: AnchoredOptions,
    placed: (placement: Placement) => void,
): () => void {
    let frame = 0
    const update = (): void => {
        frame = 0
        const placement = place(anchor, floating, options)
        // Read with `place`'s reads, before any write, so it forces no layout of its own.
        const width = anchor.getBoundingClientRect().width
        // The values `place` computed (49.6): `inset` sets the top-left corner and frees the
        // popover's UA `inset: 0`, `--arrow-offset` is where an arrow the caller draws points from,
        // and `--anchor-width` is what a list sized to its input reads (50.27).
        floating.style.inset = `${placement.y}px auto auto ${placement.x}px`
        floating.style.setProperty('--arrow-offset', `${placement.arrow}px`)
        floating.style.setProperty('--anchor-width', `${width}px`)
        placed(placement)
    }
    // A scroll fires many times a frame; one placement per frame reads the layout once.
    const scheduled = (): void => {
        if (frame === 0) frame = requestAnimationFrame(update)
    }
    // 50.48 — a layer open over its anchor that took the pointer would take it from the anchor, and an
    // anchor whose leave closes the layer then closes it and opens it again as the pointer moves.
    const passesThrough = options.interactive === false
    if (passesThrough) floating.style.pointerEvents = 'none'
    // A menu's `auto` popover is already open by the time it is anchored: the browser opened it.
    if (!floating.matches(':popover-open')) floating.showPopover()
    update()
    addEventListener('scroll', scheduled, { capture: true, passive: true })
    addEventListener('resize', scheduled, { passive: true })
    // 50.26 — a hint whose text lands after it opens, or an anchor that reflows, moves nothing a
    // scroll or a resize would report: both are watched by the observer every resize shares (32.81).
    const unresizeAnchor = resized(anchor, scheduled)
    const unresizeFloating = resized(floating, scheduled)
    return () => {
        unresizeAnchor()
        unresizeFloating()
        cancelAnimationFrame(frame)
        frame = 0
        removeEventListener('scroll', scheduled, { capture: true })
        removeEventListener('resize', scheduled)
        if (floating.matches(':popover-open')) floating.hidePopover()
        if (passesThrough) floating.style.removeProperty('pointer-events')
    }
}
