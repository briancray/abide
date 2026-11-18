// 50.26, 50.27 — AN OPEN POPOVER KEPT AGAINST ITS ANCHOR: what `Tooltip` and `Menu` share. Not an
// export of the barrel: an app's own overlay calls `place` and writes what it hands back itself.

import { place, type Placement, type PlaceOptions } from './place.ts'

/**
 * Places `floating` against `anchor` now, and again in the frame after anything scrolls or the window
 * resizes, until the stop it hands back is called. `placed` is told each placement.
 */
export function follow(
    anchor: Element,
    floating: HTMLElement,
    options: PlaceOptions,
    placed: (placement: Placement) => void,
): () => void {
    let frame = 0
    const update = (): void => {
        frame = 0
        const placement = place(anchor, floating, options)
        // The two values `place` computed (49.6): `inset` sets the top-left corner and frees the
        // popover's UA `inset: 0`, and `--arrow-offset` is where an arrow the caller draws points from.
        floating.style.inset = `${placement.y}px auto auto ${placement.x}px`
        floating.style.setProperty('--arrow-offset', `${placement.arrow}px`)
        placed(placement)
    }
    // A scroll fires many times a frame; one placement per frame reads the layout once.
    const scheduled = (): void => {
        if (frame === 0) frame = requestAnimationFrame(update)
    }
    update()
    addEventListener('scroll', scheduled, { capture: true, passive: true })
    addEventListener('resize', scheduled, { passive: true })
    return () => {
        cancelAnimationFrame(frame)
        frame = 0
        removeEventListener('scroll', scheduled, { capture: true })
        removeEventListener('resize', scheduled)
    }
}
