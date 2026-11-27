// 53.80-53.86 — A PANEL SIZED BY DRAGGING ITS EDGE: WAI-ARIA's window splitter, as parts an app spreads
// onto a panel and a handle of its own. The bounds are measured once as a drag or a key begins — the
// panel's parent less what its neighbour keeps — so a pointer moving reads no layout. Each handle
// answers the arrows of its own axis alone, so one `resizable` per axis spread on one grip sizes a
// corner.

import { checkParts } from './checkParts.ts'
import { type Live, live } from './live.ts'
import { madeId } from './madeId.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { stepOf } from './roving.ts'

/** Which way the panel sizes, which edge its handle is on, and the bounds it keeps to. */
export type ResizableOptions = {
    /** The base the panel's id is derived from; unique on the page. One is made where none is given. */
    id?: string | undefined
    /** `'x'` sizes the panel's width, `'y'` its height. `'x'` by default. */
    axis?: 'x' | 'y' | undefined
    /** The panel's edge the handle stands on: `'end'` grows it as the handle moves right or down, `'start'` as it moves left or up. `'end'` by default. */
    edge?: 'start' | 'end' | undefined
    /** The panel's size in pixels, or `undefined` for its own: a `Reactive` to read and set. Held by the parts, and handed back as `size`, where none is given. */
    size?: Reactive<number | undefined> | undefined
    /** The fewest pixels the panel keeps. `0` by default; a function is read live. */
    min?: Live<number> | undefined
    /** The most pixels the panel takes. Unbounded by default; a function is read live. */
    max?: Live<number> | undefined
    /** The pixels of the panel's parent left to what stands beside it, bounding the panel by its parent. Unbounded by its parent where none is given; a function is read live. */
    keep?: Live<number> | undefined
    /** The pixels an arrow key moves it. `10` by default; a function is read live. */
    step?: Live<number> | undefined
    /** The handle's accessible name; a function is read live. */
    label?: Live<string> | undefined
}

/** The parts `resizable` hands back: `<aside {...side.panel}>`, `<div {...side.handle}>`. */
export type Resizable = {
    /** The base its parts' ids are derived from. */
    readonly id: string
    /** The panel's attributes: `size` pixels along its axis. */
    readonly panel: Record<string, unknown>
    /** The handle's attributes, its drag and its keys. */
    readonly handle: Record<string, unknown>
    /** The panel's size in pixels, `undefined` for its own; written, it sizes the panel. */
    readonly size: Reactive<number | undefined>
}

/** WAI-ARIA's window splitter: a panel and the handle that sizes it, as parts to spread. */
export function resizable(options: ResizableOptions = {}): Resizable {
    const across = options.axis === 'y' ? 'y' : 'x'
    const sign = options.edge === 'start' ? -1 : 1
    const size = options.size ?? reactive<number | undefined>(undefined)
    const id = options.id ?? madeId('resizable')
    const panelId = `${id}-panel`
    if (process.env.NODE_ENV !== 'production') checkParts('resizable', id)
    const min = () => live(options.min) ?? 0
    const dragging = reactive(false)
    // The size before Enter collapsed it, which the next Enter restores.
    let collapsedFrom: number | undefined
    // Measured as a drag or a key begins.
    let ceiling = Number.POSITIVE_INFINITY
    let from = 0
    let at = 0

    const panelOf = () => globalThis.document?.getElementById(panelId)
    // 53.82 — the most it takes: `max`, and where `keep` is given, what its parent holds less that. A
    // parent that grows with the panel — a box sized from its corner — bounds nothing, so the parent
    // is read only where something beside the panel keeps room.
    const measure = (): number => {
        const panel = panelOf()
        const keep = live(options.keep)
        const parent =
            keep === undefined ? null : (panel?.parentElement ?? null)
        const held =
            parent === null
                ? Number.POSITIVE_INFINITY
                : (across === 'x' ? parent.clientWidth : parent.clientHeight) -
                  (keep ?? 0)
        ceiling = Math.min(live(options.max) ?? Number.POSITIVE_INFINITY, held)
        const now = size.peek()
        if (now !== undefined) return now
        const box = panel?.getBoundingClientRect()
        return (across === 'x' ? box?.width : box?.height) ?? 0
    }
    const bound = (pixels: number): number =>
        Math.max(min(), Math.min(ceiling, Math.round(pixels)))

    return {
        id,
        // 53.80 — the one value written to `style`, the size computed from the drag (49.5).
        panel: {
            id: panelId,
            'data-resizable': 'panel',
            get style() {
                const now = size()
                return now === undefined
                    ? undefined
                    : `${across === 'x' ? 'inline-size' : 'block-size'}:${now}px`
            },
        },
        // 53.86
        handle: {
            role: 'separator',
            tabindex: '0',
            'data-resizable': 'handle',
            'aria-controls': panelId,
            'aria-orientation': across === 'x' ? 'vertical' : 'horizontal',
            get 'aria-label'() {
                return live(options.label)
            },
            get 'aria-valuenow'() {
                return size()
            },
            get 'aria-valuemin'() {
                return min()
            },
            get 'aria-valuemax'() {
                const most = live(options.max)
                return most === undefined || !Number.isFinite(most)
                    ? undefined
                    : most
            },
            get 'data-dragging'() {
                return dragging() ? '' : undefined
            },
            // 53.81 — captured, so the moves land on the handle wherever the pointer goes.
            onpointerdown: (event: PointerEvent) => {
                if (event.button !== 0) return
                event.preventDefault()
                ;(event.currentTarget as Element).setPointerCapture?.(
                    event.pointerId,
                )
                from = measure()
                at = across === 'x' ? event.clientX : event.clientY
                dragging.set(true)
            },
            onpointermove: (event: PointerEvent) => {
                if (!dragging.peek()) return
                const moved =
                    (across === 'x' ? event.clientX : event.clientY) - at
                size.set(bound(from + moved * sign))
            },
            onpointerup: () => dragging.set(false),
            onpointercancel: () => dragging.set(false),
            // 53.83, 53.84
            onkeydown: (event: KeyboardEvent) => {
                const step = live(options.step) ?? 10
                let next: number | undefined
                let keptFrom = collapsedFrom
                const toward = stepOf(
                    event.key,
                    across === 'x' ? 'horizontal' : 'vertical',
                )
                if (toward !== 0) {
                    next = measure() + toward * sign * step
                } else if (event.key === 'Home') {
                    measure()
                    next = min()
                } else if (event.key === 'End') {
                    measure()
                    next = ceiling
                } else if (event.key === 'Enter') {
                    const now = measure()
                    if (collapsedFrom === undefined) {
                        keptFrom = now
                        next = min()
                    } else {
                        next = collapsedFrom
                        keptFrom = undefined
                    }
                } else return
                event.preventDefault()
                // 49.19 — what Enter restores moves only with a size that landed.
                if (
                    Number.isFinite(next) &&
                    size.set(bound(next)) === undefined
                )
                    collapsedFrom = keptFrom
            },
            // 53.85
            ondblclick: () => {
                if (size.set(undefined) === undefined) collapsedFrom = undefined
            },
        },
        size,
    }
}
