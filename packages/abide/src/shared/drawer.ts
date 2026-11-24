// 50.61-50.64 — A PANEL FROM AN EDGE OF THE PAGE: a `dialog` with a `resizable`'s panel laid over it,
// as parts an app spreads onto a `<dialog>` and a handle of its own. Where it stands is the app's CSS,
// told by `data-side`; the dialog opens and dismisses it, and the handle on its inner edge sizes it —
// and, given `stops`, settles it at the stop nearest where the drag would come to rest, carried on by
// its speed so a flick reaches the next stop, closing it where that is below every stop.

import { dialog, type DialogOptions } from './dialog.ts'
import { type Live, live } from './live.ts'
import type { Reactive } from './reactive/index.ts'
import { resizable } from './resizable.ts'
import { withPart } from './withPart.ts'

/** The edge it stands on, how it opens, and the bounds of its size. */
export type DrawerOptions = DialogOptions & {
    /** The edge of the page it stands on. `'end'` by default; read once, since it fixes the axis it sizes along. */
    side?: 'start' | 'end' | 'top' | 'bottom'
    /** Its size in pixels across its edge, or `undefined` for its own: a `Reactive` to read and set. Held by the parts, and handed back as `size`, where none is given. */
    size?: Reactive<number | undefined>
    /** The fewest pixels it keeps. `0` by default; a function is read live. */
    min?: Live<number>
    /** The most pixels it takes. Unbounded by default; a function is read live. */
    max?: Live<number>
    /** The handle's accessible name; a function is read live. */
    label?: Live<string>
    /** The sizes it settles at when its handle is let go, as shares of the viewport across `side`. Below every stop it closes. None by default, and it rests where it is dropped; a function is read live. */
    stops?: Live<readonly number[]>
}

/** The parts `drawer` hands back: `<dialog {...filters.drawer}>`, `<div {...filters.handle}>`. */
export type Drawer = {
    /** The `<dialog>`'s part: `dialog`'s, sized as a `resizable`'s panel, with `data-side`. */
    readonly drawer: Record<string, unknown>
    /** The handle on its inner edge: a `resizable`'s. */
    readonly handle: Record<string, unknown>
    /** Whether it is showing — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
    /** Its size in pixels, `undefined` for its own; written, it sizes it. */
    readonly size: Reactive<number | undefined>
}

// How far ahead a drag's speed carries it, in milliseconds, before the nearest stop is chosen.
const CARRY = 150

/** A dialog standing on an edge of the page, sized from the handle on its inner edge. */
export function drawer(options: DrawerOptions = {}): Drawer {
    const side = options.side ?? 'end'
    const across = side === 'top' || side === 'bottom' ? 'y' : 'x'
    const shown = dialog(options)
    // 50.62 — sized across its edge, growing as the handle moves away from the edge it stands on.
    const sized = resizable({
        ...options,
        axis: across,
        edge: side === 'start' || side === 'top' ? 'end' : 'start',
    })
    const handle = withPart(withPart({}, sized.handle), {
        'data-drawer': 'handle',
    })
    if (options.stops !== undefined) {
        // 50.63 — growing is moving right or down from the start or top edge, left or up from the others.
        const growing = side === 'start' || side === 'top' ? 1 : -1
        const at = (event: PointerEvent): number =>
            across === 'x' ? event.clientX : event.clientY
        let last = 0
        let lastAt = 0
        let speed = 0
        const settle = (): void => {
            const viewport =
                across === 'x' ? globalThis.innerWidth : globalThis.innerHeight
            const now = sized.size.peek()
            if (now === undefined || viewport === undefined) return
            const resting = now + speed * CARRY
            let nearest = 0
            for (const stop of live(options.stops) ?? [])
                if (
                    Math.abs(stop * viewport - resting) <
                    Math.abs(nearest * viewport - resting)
                )
                    nearest = stop
            speed = 0
            if (nearest === 0) return shown.open.set(false)
            sized.size.set(Math.round(nearest * viewport))
        }
        // The resizable's own listeners run first: a part laid over another replaces a key, never adds to it.
        const sizing = sized.handle as Record<
            string,
            (event: PointerEvent) => void
        >
        withPart(handle, {
            onpointerdown: (event: PointerEvent) => {
                sizing.onpointerdown?.(event)
                last = at(event)
                lastAt = event.timeStamp
                speed = 0
            },
            // The speed of the drag, in pixels a millisecond of growth, from its last two moves.
            onpointermove: (event: PointerEvent) => {
                sizing.onpointermove?.(event)
                if (event.buttons === 0) return
                // Moves under a millisecond apart say nothing of speed.
                if (event.timeStamp - lastAt >= 1)
                    speed =
                        (growing * (at(event) - last)) /
                        (event.timeStamp - lastAt)
                last = at(event)
                lastAt = event.timeStamp
            },
            onpointerup: (event: PointerEvent) => {
                sizing.onpointerup?.(event)
                settle()
            },
        })
    }
    return {
        // 50.61
        drawer: withPart(withPart(withPart({}, shown.dialog), sized.panel), {
            'data-drawer': 'drawer',
            'data-side': side,
        }),
        handle,
        open: shown.open,
        size: sized.size,
    }
}
