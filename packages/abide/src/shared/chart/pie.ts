// 52.29, 52.30, 52.38, 52.39, 52.63-52.68 — SHARES OF A WHOLE AS PARTS: slices of a ring, clockwise from
// the top in the order given, each a stroke along one circle as long as its share of the circumference,
// so a pie and a donut are one drawing. Each slice's part opens its hint in the page's `Tooltips` and
// takes its pick. `Pie` is default markup over these parts (49.9).

import { number, percent } from '../format/index.ts'
import { type Live, live } from '../live.ts'
import { reactive } from '../reactive/index.ts'
import type { Disposer } from '../reactive/watch.ts'
import { tip } from '../tooltip/tip.ts'

/** What `pie` draws and how. A value is read live where a function is given. */
export type PieOptions = {
    /** The slices in order, each a label and its value. */
    slices: Live<readonly { label: string; value: number | null | undefined }[]>
    /** What the pie shows, as its accessible name: `'Open pipeline by stage'`. */
    label: Live<string>
    /** The hole at the center, as a fraction of the radius: `0.6` for a donut. `0` by default. */
    inner?: Live<number>
    /** Writes a slice's value for its hint: `format.money`, say. `format.number` by default. */
    valueFormat?: (value: number) => string
    /** Called with the index of a slice clicked, where `disabled` does not hold for it (52.38). */
    onpick?: (index: number) => void
    /** Whether a slice takes no pick, written as `data-disabled` on it (52.39). */
    disabled?: (index: number) => boolean
}

/** One slice drawn: a value missing, zero or below it is none (52.66). */
export type PieSlice = {
    index: number
    label: string
    value: number
    /** Its share of the whole, from 0 to 1. */
    share: number
    /** Its label, value and share, as its hint reads them. */
    hint: string
    /** `<circle {...slice.circle} />`: the stroke, its sweep as `style` (52.64), its hint and its pick. */
    circle: Record<string, unknown>
}

/** The parts `pie` hands back. */
export type PieParts = {
    /** The `<svg>`: its square of drawing units, its role and its name (52.29). */
    readonly svg: Record<string, unknown>
    /** The slices drawn, in order. */
    slices(): PieSlice[]
}

// The drawing's own units: a ring centered in a square this wide.
const SIZE = 100
const CENTER = SIZE / 2

/** Shares of a whole as the slices of a pie or a donut, as parts to spread. */
export function pie(options: PieOptions): PieParts {
    const valueFormat =
        options.valueFormat ?? ((value: number) => number(value))
    // A slice's hint binding, kept while its words stand, so a sweep that eases binds nothing again.
    const hints = new Map<string, (element: Element) => Disposer>()
    const hinted = (text: string) => {
        let bind = hints.get(text)
        if (bind === undefined) {
            bind = tip(text)
            hints.set(text, bind)
        }
        return bind
    }

    const ring = reactive(() => {
        const slices = live(options.slices)
        const hole =
            Math.min(Math.max(live(options.inner) ?? 0, 0), 0.95) * CENTER
        const radius = (CENTER + hole) / 2
        const circumference = 2 * Math.PI * radius
        let total = 0
        for (const slice of slices) total += drawable(slice.value)
        const drawn: PieSlice[] = []
        let before = 0
        for (let index = 0; index < slices.length; index += 1) {
            const slice = slices[index] as (typeof slices)[0]
            const value = drawable(slice.value)
            if (value === 0) continue
            const share = value / total
            const hint = `${slice.label}: ${valueFormat(value)} (${percent(share)})`
            drawn.push({
                index,
                label: slice.label,
                value,
                share,
                hint,
                circle: {
                    'data-part': 'slice',
                    'data-series': index,
                    'data-disabled':
                        options.disabled?.(index) === true ? '' : undefined,
                    cx: CENTER,
                    cy: CENTER,
                    r: radius,
                    fill: 'none',
                    stroke: 'currentColor',
                    'stroke-width': CENTER - hole,
                    transform: `rotate(-90 ${CENTER} ${CENTER})`,
                    // 52.64 — the sweep as `style` properties, which a CSS transition eases.
                    style: `stroke-dasharray: ${share * circumference} ${circumference}; stroke-dashoffset: ${-before * circumference}`,
                    'bind:element': hinted(hint),
                    onclick: () => pick(index),
                },
            })
            before += share
        }
        return drawn
    })

    // 52.38 — the click lands on the slice's own stroke, so the slice is the one under the pointer.
    function pick(index: number) {
        if (options.onpick === undefined || options.disabled?.(index) === true)
            return
        options.onpick(index)
    }

    return {
        svg: {
            viewBox: `0 0 ${SIZE} ${SIZE}`,
            role: 'img',
            get 'aria-label'() {
                return live(options.label)
            },
        },
        slices: () => ring(),
    }
}

// 52.66 — a value missing, zero or below it is no slice.
function drawable(value: number | null | undefined): number {
    return value === null || value === undefined || !(value > 0) ? 0 : value
}
