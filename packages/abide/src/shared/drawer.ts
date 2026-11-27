// 50.61-50.64 — A PANEL FROM AN EDGE OF THE PAGE: a `dialog` with a `resizable`'s panel laid over it,
// as parts an app spreads onto a `<dialog>` and a handle of its own. Where it stands is the app's CSS,
// told by `data-side`; the dialog opens and dismisses it, and the handle on its inner edge sizes it —
// and, given `stops`, follows a drag by a transform alone, settles it at the stop nearest where the
// drag would come to rest, carried on by its speed so a flick reaches the next stop, closing it where
// that is below every stop, and steps a tap on to the next stop.

import { dialog, type DialogOptions } from './dialog.ts'
import { type Live, live } from './live.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import { resizable } from './resizable.ts'
import { withPart } from './withPart.ts'

/** The edge it stands on, how it opens, and the bounds of its size. */
export type DrawerOptions = DialogOptions & {
    /** The edge of the page it stands on. `'end'` by default; read once, since it fixes the axis it sizes along. */
    side?: 'start' | 'end' | 'top' | 'bottom' | undefined
    /** Its size in pixels across its edge, or `undefined` for its own: a `Reactive` to read and set. Held by the parts, and handed back as `size`, where none is given. */
    size?: Reactive<number | undefined> | undefined
    /** The fewest pixels it keeps. `0` by default; a function is read live. */
    min?: Live<number> | undefined
    /** The most pixels it takes. Unbounded by default; a function is read live. */
    max?: Live<number> | undefined
    /** The handle's accessible name; a function is read live. */
    label?: Live<string> | undefined
    /** The sizes it settles at when its handle is let go, as shares of the viewport across `side`. Below every stop it closes. None by default, and it rests where it is dropped; a function is read live. */
    stops?: Live<readonly number[]> | undefined
}

/** The parts `drawer` hands back: `<dialog {...filters.drawer}>`, `<div {...filters.handle}>`. */
export type Drawer = {
    /** The `<dialog>`'s part: `dialog`'s, sized as a `resizable`'s panel, with `data-side`. */
    readonly drawer: Record<string, unknown>
    /** An element inside the `<dialog>` standing for its backdrop: `dialog`'s. */
    readonly backdrop: Record<string, unknown>
    /** The handle on its inner edge: a `resizable`'s. */
    readonly handle: Record<string, unknown>
    /** Whether it is showing — the `open` it was handed, or one of its own. */
    readonly open: Reactive<boolean>
    /** Its size in pixels, `undefined` for its own; written, it sizes it. */
    readonly size: Reactive<number | undefined>
}

// How far ahead a drag's speed carries it, in milliseconds, before the nearest stop is chosen.
const CARRY = 150
// 50.84 — how far a press moves, in pixels, before it is a drag rather than a tap.
const SLOP = 8

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
    const handle = withPart({}, sized.handle, {
        'data-drawer': 'handle',
    })
    // 50.63 — pushed toward its edge by this many pixels while a drag follows the pointer, so the
    // drag moves it by a transform alone and lays nothing out until it is let go.
    const pushed = reactive<number | undefined>(undefined)
    if (options.stops !== undefined) {
        // 50.63 — growing is moving right or down from the start or top edge, left or up from the others.
        const growing = side === 'start' || side === 'top' ? 1 : -1
        const at = (event: PointerEvent): number =>
            across === 'x' ? event.clientX : event.clientY
        const viewport = (): number =>
            (across === 'x' ? globalThis.innerWidth : globalThis.innerHeight) ??
            0
        const stopsOf = (): readonly number[] => live(options.stops) ?? []
        let pressedAt: number | undefined
        // The size as the press began, and the size it stands at while it follows the pointer.
        let from = 0
        let stood: number | undefined
        let last = 0
        let lastAt = 0
        let speed = 0
        const panelOf = () =>
            globalThis.document?.getElementById(`${sized.id}-panel`)
        const measured = (): number => {
            const now = sized.size.peek()
            if (now !== undefined) return now
            const box = panelOf()?.getBoundingClientRect()
            return (across === 'x' ? box?.width : box?.height) ?? 0
        }
        // The stop nearest `pixels`, as a share of the viewport, or 0 where none is nearer than none.
        const nearest = (pixels: number, none: boolean): number => {
            const extent = viewport()
            let chosen = none ? 0 : Number.NaN
            for (const stop of stopsOf())
                if (
                    Number.isNaN(chosen) ||
                    Math.abs(stop * extent - pixels) <
                        Math.abs(chosen * extent - pixels)
                )
                    chosen = stop
            return chosen
        }
        const commit = (stop: number): void => {
            pushed.set(undefined)
            stood = undefined
            if (Number.isNaN(stop)) return
            if (stop === 0) {
                sized.size.set(from)
                shown.open.set(false)
                return
            }
            sized.size.set(Math.round(stop * viewport()))
        }
        // The resizable's own press and release, which capture the pointer and mark `data-dragging`;
        // its move is left out, since a drag here sizes nothing until it is let go. A part laid over
        // another replaces a key, never adds to it.
        const sizing = sized.handle as Record<
            string,
            (event: PointerEvent) => void
        >
        withPart(handle, {
            onpointerdown: (event: PointerEvent) => {
                if (event.button !== 0) return
                sizing.onpointerdown?.(event)
                pressedAt = at(event)
                from = measured()
                last = pressedAt
                lastAt = event.timeStamp
                speed = 0
            },
            onpointermove: (event: PointerEvent) => {
                if (pressedAt === undefined) return
                const moved = growing * (at(event) - pressedAt)
                // The speed of the drag, in pixels a millisecond of growth, from its last two moves;
                // moves under a millisecond apart say nothing of it.
                if (event.timeStamp - lastAt >= 1)
                    speed =
                        (growing * (at(event) - last)) /
                        (event.timeStamp - lastAt)
                last = at(event)
                lastAt = event.timeStamp
                if (stood === undefined) {
                    // 50.84 — a press that has not moved past the slop may still be a tap.
                    if (Math.abs(moved) < SLOP) return
                    // Stood at its largest stop once, pushed back to where it stood: the one layout
                    // of the drag.
                    let largest = from
                    for (const stop of stopsOf())
                        largest = Math.max(largest, stop * viewport())
                    stood = Math.round(largest)
                    sized.size.set(stood)
                }
                pushed.set(stood - Math.max(0, Math.min(stood, from + moved)))
            },
            onpointerup: (event: PointerEvent) => {
                sizing.onpointerup?.(event)
                const begun = pressedAt
                pressedAt = undefined
                if (begun === undefined) return
                if (stood === undefined) {
                    // 50.84 — a tap stands it at the stop after the one nearest its size.
                    const stops = stopsOf()
                    const current = stops.indexOf(nearest(from, false))
                    const next = stops[(current + 1) % stops.length]
                    if (next !== undefined) commit(next)
                    return
                }
                const resting = stood - (pushed.peek() ?? 0) + speed * CARRY
                speed = 0
                commit(nearest(resting, true))
            },
            onpointercancel: (event: PointerEvent) => {
                sizing.onpointercancel?.(event)
                pressedAt = undefined
                if (stood !== undefined) {
                    pushed.set(undefined)
                    stood = undefined
                    sized.size.set(from)
                }
            },
        })
    }
    return {
        // 50.61
        drawer: withPart({}, shown.dialog, sized.panel, {
            'data-drawer': 'drawer',
            'data-side': side,
            // 49.5 — the size the handle set, and while a drag follows the pointer, how far it is pushed.
            get style() {
                const sizing = sized.panel.style as string | undefined
                const by = pushed()
                if (by === undefined) return sizing
                const toward =
                    side === 'start' || side === 'top' ? -by : by
                return `${sizing === undefined ? '' : `${sizing};`}transform:translate${across === 'x' ? 'X' : 'Y'}(${toward}px)`
            },
            get 'data-following'() {
                return pushed() === undefined ? undefined : ''
            },
        }),
        backdrop: withPart({}, shown.backdrop, {
            'data-drawer': 'backdrop',
        }),
        handle,
        open: shown.open,
        size: sized.size,
    }
}
