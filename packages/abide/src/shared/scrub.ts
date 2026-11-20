// 52.26, 52.70, 52.71 — A POSITION ALONG AN AXIS, PICKED BY THE POINTER OR THE KEYBOARD: the pointer
// takes the position nearest it, and the arrows step one position at a time, stopping at the ends, with
// Home and End at the first and the last. Leaving — the pointer, or focus — picks none. What a `Chart`'s
// crosshair stands at; the chart decides what standing there shows.

import { nearest } from './chart/index.ts'
import type { Reactive } from './reactive/Reactive.ts'
import { roving } from './roving.ts'

/**
 * The handlers that write `at` — the index picked, `-1` for none — from the element they are bound to.
 *
 * @param at the index picked, which the handlers write
 * @param positions each position's x in the drawing's units, ascending
 * @param width how wide the drawing is in its own units, read against the element's laid-out width
 */
export function scrub(
    at: Reactive<number>,
    positions: () => readonly number[],
    width: () => number,
) {
    /** The position nearest a pointer event, or `undefined` where the element has no width to read it on. */
    function indexAt(event: MouseEvent): number | undefined {
        const box = (event.currentTarget as Element).getBoundingClientRect()
        if (box.width === 0) return undefined
        return nearest(
            positions(),
            ((event.clientX - box.left) * width()) / box.width,
        )
    }
    return {
        indexAt,
        move(event: PointerEvent): void {
            const index = indexAt(event)
            if (index !== undefined) at.set(index)
        },
        leave(): void {
            at.set(-1)
        },
        // 52.70 — the arrows along the axis, and Home and End, with no going round the ends.
        key(event: KeyboardEvent): void {
            const to = roving(
                event.key,
                'horizontal',
                () => [at.peek() ?? -1, positions().length],
                false,
            )
            if (to === -1) return
            event.preventDefault()
            at.set(to)
        },
    }
}
