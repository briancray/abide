// 52.26, 52.69, 51.85-51.90 — A POSITION ALONG AN AXIS, PICKED BY THE POINTER OR THE KEYBOARD: the
// pointer takes the position nearest it, and the arrows step one position at a time, stopping at the
// ends, with Home and End at the first and the last. Leaving picks none. What a `chart`'s crosshair
// stands at and where a `slider`'s thumb sits; each decides what standing there means.

import { roving } from './roving.ts'

/** Where a scrub stands: the index it reads, and how it is written — a `Reactive<number>`, or a thumb that keeps within its neighbour. */
export type ScrubPosition = {
    peek(): number | undefined
    set(index: number): void
}

/** The positions a scrub moves among. */
export type ScrubAxis = {
    /** How many positions there are. */
    count(): number
    /** The index of the position nearest `fraction`, the share of the element's width from its left edge. */
    nearest(fraction: number): number
}

/** The handlers that write `at` — the index picked, `-1` for none — from the element they are bound to. */
export function scrub(at: ScrubPosition, axis: ScrubAxis) {
    /** The position nearest a pointer event, or `undefined` where the element has no width to read it on. */
    function indexAt(event: MouseEvent): number | undefined {
        const box = (event.currentTarget as Element).getBoundingClientRect()
        if (box.width === 0) return undefined
        return axis.nearest((event.clientX - box.left) / box.width)
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
        // 52.69, 51.87 — the arrows along the axis, and Home and End, with no going round the ends.
        key(event: KeyboardEvent): void {
            const to = roving(
                event.key,
                'horizontal',
                () => [at.peek() ?? -1, axis.count()],
                false,
            )
            if (to === -1) return
            event.preventDefault()
            at.set(to)
        },
    }
}
