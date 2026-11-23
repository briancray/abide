// 50.63, 50.64 — A PANEL RISING FROM THE BOTTOM, DRAGGED BETWEEN STOPS: a `drawer` on the bottom edge
// whose handle, let go, settles at the stop nearest where the drag would come to rest — carried on by
// its speed, so a flick reaches the next stop — and closes where that is below every stop.

import { type Drawer, drawer, type DrawerOptions } from './drawer.ts'
import { type Live, live } from './live.ts'
import { withPart } from './withPart.ts'

/** How it opens, and the heights it settles at. */
export type SheetOptions = Omit<DrawerOptions, 'side'> & {
    /** The heights it settles at, as shares of the viewport's height. `[0.5, 1]` by default; a function is read live. */
    stops?: Live<readonly number[]>
}

// How far ahead a drag's speed carries it, in milliseconds, before the nearest stop is chosen.
const CARRY = 150

/** A drawer on the bottom edge that settles at `stops`, closing below them. */
export function sheet(options: SheetOptions = {}): Drawer {
    const rising = drawer({ ...options, side: 'bottom' })
    let lastY = 0
    let lastAt = 0
    let speed = 0
    // 50.64 — the speed of the drag, in pixels a millisecond upward, from its last two moves.
    const moved = (event: PointerEvent): void => {
        if (event.buttons === 0) return
        const at = event.timeStamp
        // Moves under a millisecond apart say nothing of speed.
        if (at - lastAt >= 1) speed = (lastY - event.clientY) / (at - lastAt)
        lastY = event.clientY
        lastAt = at
    }
    const settle = (): void => {
        const height = globalThis.innerHeight
        const now = rising.size.peek()
        if (now === undefined || height === undefined) return
        const resting = now + speed * CARRY
        let nearest = 0
        for (const stop of live(options.stops) ?? [0.5, 1])
            if (
                Math.abs(stop * height - resting) <
                Math.abs(nearest * height - resting)
            )
                nearest = stop
        speed = 0
        if (nearest === 0) return rising.open.set(false)
        rising.size.set(Math.round(nearest * height))
    }
    // The resizable's own listeners run first: a part laid over another replaces a key, never adds to it.
    const sizing = rising.handle as Record<
        string,
        (event: PointerEvent) => void
    >
    return {
        ...rising,
        handle: withPart(withPart({}, rising.handle), {
            'data-sheet': 'handle',
            onpointerdown: (event: PointerEvent) => {
                sizing.onpointerdown?.(event)
                lastY = event.clientY
                lastAt = event.timeStamp
                speed = 0
            },
            onpointermove: (event: PointerEvent) => {
                sizing.onpointermove?.(event)
                moved(event)
            },
            onpointerup: (event: PointerEvent) => {
                sizing.onpointerup?.(event)
                settle()
            },
        }),
        drawer: withPart(withPart({}, rising.drawer), {
            'data-sheet': 'sheet',
        }),
    }
}
