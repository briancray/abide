// 52.106-52.109 — A VALUE SHOWN WITHIN ITS RANGE: WAI-ARIA's meter, or its progress bar, as parts an
// app spreads onto a track and a fill of its own. The fill's width is the one value written to
// `style`, computed from the value (49.5); a progress bar with no value is indeterminate.

import { type Live, live } from './live.ts'

/** The value shown, the range it falls in, and the bands that mark it low or high. */
export type MeterOptions = {
    /** The value; `undefined` for a progress bar whose progress is not known. A function is read live. */
    value: Live<number | undefined>
    /** The bottom of the range. `0` by default; a function is read live. */
    min?: Live<number>
    /** The top of the range. `1` by default; a function is read live. */
    max?: Live<number>
    /** Below this the value is `low`. A function is read live. */
    low?: Live<number>
    /** Above this the value is `high`. A function is read live. */
    high?: Live<number>
    /** `'progressbar'` for progress toward an end rather than a measure. `'meter'` by default; a function is read live. */
    role?: Live<'meter' | 'progressbar'>
    /** The accessible name; a function is read live. */
    label?: Live<string>
}

/** The parts `meter` hands back: `<div {...quota.meter}><div {...quota.fill}></div></div>`. */
export type Meter = {
    /** The track's attributes: its role, the value and range it reads out, and its level. */
    readonly meter: Record<string, unknown>
    /** The fill's attributes: as wide as the value is far along the range. */
    readonly fill: Record<string, unknown>
    /** How far along the range the value is, from `0` to `1`; `undefined` where it is not known. */
    get fraction(): number | undefined
}

/** WAI-ARIA's meter or progress bar over a value and its range, as parts to spread. */
export function meter(options: MeterOptions): Meter {
    const value = () => live(options.value)
    const min = () => live(options.min) ?? 0
    const max = () => live(options.max) ?? 1
    const fraction = (): number | undefined => {
        const now = value()
        if (now === undefined) return undefined
        const span = max() - min()
        return span <= 0 ? 0 : Math.min(1, Math.max(0, (now - min()) / span))
    }
    return {
        // 52.106, 52.107, 52.109
        meter: {
            'data-meter': 'meter',
            get role() {
                return live(options.role) ?? 'meter'
            },
            get 'aria-label'() {
                return live(options.label)
            },
            get 'aria-valuenow'() {
                return value()
            },
            get 'aria-valuemin'() {
                return min()
            },
            get 'aria-valuemax'() {
                return max()
            },
            get 'data-indeterminate'() {
                return value() === undefined ? '' : undefined
            },
            get 'data-level'() {
                const now = value()
                const low = live(options.low)
                const high = live(options.high)
                if (
                    now === undefined ||
                    (low === undefined && high === undefined)
                )
                    return undefined
                if (low !== undefined && now < low) return 'low'
                if (high !== undefined && now > high) return 'high'
                return 'middle'
            },
        },
        // 52.108
        fill: {
            'data-meter': 'fill',
            get style() {
                const part = fraction()
                return part === undefined
                    ? undefined
                    : `inline-size:${Math.round(part * 10_000) / 100}%`
            },
        },
        get fraction() {
            return fraction()
        },
    }
}
