// 53.92-53.98 — A SURFACE MOVED AND MAGNIFIED: what a map, a plan or a large drawing sits in, as parts an
// app spreads onto a surface and the content inside it. A wheel pans and, with Ctrl or ⌘ — a trackpad's
// pinch arrives so — zooms about the pointer; a pointer drags it, two pinch it; the keys step it. The
// view is one `{ x, y, k }`, and the content's one style is the transform it computes (49.5).

import { type Live, live } from './live.ts'
import { type Bindable, bindable } from './reactive/bindable.ts'
import { type Reactive, reactive } from './reactive/index.ts'
import type { Disposer } from './reactive/watch.ts'

/** Where the content stands in the surface: moved by `x` and `y` pixels, magnified by `k`. */
export type PanZoomView = {
    readonly x: number
    readonly y: number
    readonly k: number
}

/** The bounds of its magnification, what a key moves it by, and its view. */
export type PanZoomOptions = {
    /** Where it stands: a `Reactive` to read and set. Held by the parts, and handed back as `view`, where none is given. */
    view?: Bindable<PanZoomView> | undefined
    /** The least magnification. `0.25` by default; a function is read live. */
    min?: Live<number> | undefined
    /** The most magnification. `8` by default; a function is read live. */
    max?: Live<number> | undefined
    /** The surface's accessible name; a function is read live. */
    label?: Live<string> | undefined
}

/** The parts `panZoom` hands back, its view, and what moves it from code. */
export type PanZoom = {
    /** The surface's attributes: its wheel, its pointers and its keys. */
    readonly surface: Record<string, unknown>
    /** The content's attributes: the transform the view computes. */
    readonly content: Record<string, unknown>
    /** Where it stands; written, it moves there. */
    readonly view: Reactive<PanZoomView>
    /** Magnifies it by `factor` about a point of the surface, its middle by default. */
    zoomBy(factor: number, at?: { x: number; y: number }): void
    /** Moves and magnifies it so a box of the content fills the surface, `margin` pixels clear of its edges. */
    fit(
        box: { x: number; y: number; width: number; height: number },
        margin?: number,
    ): void
}

const HOME: PanZoomView = { x: 0, y: 0, k: 1 }
// How far a key pans, how much a key magnifies, and how much a wheel's pixel magnifies.
const PAN = 40
const STEP = 1.25
const WHEEL = 0.0015

/** A surface panned and zoomed by its wheel, its pointers and its keys, as parts to spread. */
export function panZoom(options: PanZoomOptions = {}): PanZoom {
    const view = bindable(options.view) ?? reactive<PanZoomView>(HOME)
    const now = () => view.peek() ?? HOME
    let surface: Element | undefined
    const size = () => {
        const box = surface?.getBoundingClientRect()
        return {
            left: box?.left ?? 0,
            top: box?.top ?? 0,
            width: box?.width ?? 0,
            height: box?.height ?? 0,
        }
    }

    // 53.95 — kept from `min` to `max`, the point `at` held still as it magnifies.
    const zoomBy = (factor: number, at?: { x: number; y: number }): void => {
        const { x, y, k } = now()
        const bounds = size()
        const point = at ?? { x: bounds.width / 2, y: bounds.height / 2 }
        const next = Math.min(
            live(options.max) ?? 8,
            Math.max(live(options.min) ?? 0.25, k * factor),
        )
        const kept = next / k
        view.set({
            x: point.x - (point.x - x) * kept,
            y: point.y - (point.y - y) * kept,
            k: next,
        })
    }
    const panBy = (dx: number, dy: number): void => {
        const { x, y, k } = now()
        view.set({ x: x + dx, y: y + dy, k })
    }
    const local = (event: { clientX: number; clientY: number }) => {
        const { left, top } = size()
        return { x: event.clientX - left, y: event.clientY - top }
    }

    // 53.94 — the pointers down, so one pans and two pinch.
    const pointers = new Map<number, { x: number; y: number }>()
    const spread = ():
        { middle: { x: number; y: number }; distance: number } | undefined => {
        if (pointers.size !== 2) return undefined
        const [a, b] = [...pointers.values()] as [
            { x: number; y: number },
            { x: number; y: number },
        ]
        return {
            middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            distance: Math.hypot(a.x - b.x, a.y - b.y),
        }
    }

    return {
        surface: {
            tabindex: '0',
            'data-pan-zoom': 'surface',
            get 'aria-label'() {
                return live(options.label)
            },
            'bind:element': (element: Element): Disposer => {
                surface = element
                return () => {
                    if (surface === element) surface = undefined
                }
            },
            // 53.93
            onwheel: (event: WheelEvent) => {
                event.preventDefault()
                if (event.ctrlKey || event.metaKey)
                    zoomBy(Math.exp(-event.deltaY * WHEEL), local(event))
                else panBy(-event.deltaX, -event.deltaY)
            },
            onpointerdown: (event: PointerEvent) => {
                if (event.pointerType === 'mouse' && event.button !== 0) return
                ;(event.currentTarget as Element).setPointerCapture?.(
                    event.pointerId,
                )
                pointers.set(event.pointerId, local(event))
            },
            onpointermove: (event: PointerEvent) => {
                const was = pointers.get(event.pointerId)
                if (was === undefined) return
                const before = spread()
                const at = local(event)
                pointers.set(event.pointerId, at)
                const after = spread()
                if (
                    before !== undefined &&
                    after !== undefined &&
                    before.distance > 0
                ) {
                    zoomBy(after.distance / before.distance, after.middle)
                    panBy(
                        after.middle.x - before.middle.x,
                        after.middle.y - before.middle.y,
                    )
                } else if (pointers.size === 1)
                    panBy(at.x - was.x, at.y - was.y)
            },
            onpointerup: (event: PointerEvent) =>
                pointers.delete(event.pointerId),
            onpointercancel: (event: PointerEvent) =>
                pointers.delete(event.pointerId),
            // 53.98
            ondblclick: (event: MouseEvent) => zoomBy(2, local(event)),
            // 53.96
            onkeydown: (event: KeyboardEvent) => {
                const moves: Record<string, () => void> = {
                    '+': () => zoomBy(STEP),
                    '=': () => zoomBy(STEP),
                    '-': () => zoomBy(1 / STEP),
                    ArrowLeft: () => panBy(PAN, 0),
                    ArrowRight: () => panBy(-PAN, 0),
                    ArrowUp: () => panBy(0, PAN),
                    ArrowDown: () => panBy(0, -PAN),
                    '0': () => view.set(HOME),
                }
                const move = moves[event.key]
                if (move === undefined || event.metaKey || event.ctrlKey) return
                event.preventDefault()
                move()
            },
        },
        // 53.92
        content: {
            'data-pan-zoom': 'content',
            get style() {
                const { x, y, k } = view.get() ?? HOME
                // To a hundredth of a pixel, so a float's last digits do not write the attribute.
                const at = (pixels: number) => Math.round(pixels * 100) / 100
                return `transform:translate(${at(x)}px,${at(y)}px) scale(${Math.round(k * 10_000) / 10_000});transform-origin:0 0`
            },
        },
        view,
        zoomBy,
        // 53.97
        fit: (box, margin = 0) => {
            const { width, height } = size()
            const k = Math.min(
                live(options.max) ?? 8,
                Math.max(
                    live(options.min) ?? 0.25,
                    Math.min(
                        (width - 2 * margin) / box.width,
                        (height - 2 * margin) / box.height,
                    ),
                ),
            )
            view.set({
                x: (width - box.width * k) / 2 - box.x * k,
                y: (height - box.height * k) / 2 - box.y * k,
                k,
            })
        },
    }
}
