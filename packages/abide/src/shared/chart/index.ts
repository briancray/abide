// The `chart` namespace: the arithmetic under a chart, apart from any one way of drawing it — round
// ticks, a linear scale, a path that breaks where a value is missing, series piled into stacks, and
// the point nearest the pointer. `Chart`, `Pie` and `Sparkline` draw with it, and so can a chart of
// your own.

/** One series of a chart: what it is called, its values in x order, how it is drawn, and its stack. */
export type Series = {
    /** What the series is called, in the readout. */
    label: string
    /** One value per x position. `null` or `undefined` is a value missing there. */
    values: readonly (number | null | undefined)[]
    /** How `Chart` draws it: a line, a column per value, or a filled area. `'line'` by default. */
    kind?: 'line' | 'column' | 'area'
    /** The stack it piles into with the series naming the same one, or `false` for none (52.55). */
    stack?: string | false
}

/**
 * 52.54-52.58 — where each series stands at each x once the stacks are piled: `high` is the value
 * drawn, `low` the top of what is stacked under it, and both are shares of their stack's total under
 * `normalize`; `stack` is the stack it joined. A series in no stack keeps its own values, with `low`
 * absent; a missing value there is absent from `high` too.
 */
export function stack<Each extends Pick<Series, 'values' | 'stack'>>(
    series: readonly Each[],
    options: { stack?: boolean; normalize?: boolean } = {},
): {
    low: (number | undefined)[]
    high: (number | undefined)[]
    stack: string | undefined
}[] {
    const normalize = options.normalize === true
    const stackAll = normalize || options.stack === true
    let length = 0
    for (const each of series) length = Math.max(length, each.values.length)
    // A stack's running totals per x, the positive side and the negative one apart (52.54), and the
    // sum of its magnitudes per x for 52.57.
    const totals = new Map<
        string,
        { up: number[]; down: number[]; magnitude: number[] }
    >()
    const keys: (string | undefined)[] = []
    for (const each of series) {
        const key =
            each.stack === false
                ? undefined
                : (each.stack ?? (stackAll ? '' : undefined))
        keys.push(key)
        if (key === undefined) continue
        let total = totals.get(key)
        if (total === undefined) {
            total = {
                up: new Array(length).fill(0),
                down: new Array(length).fill(0),
                magnitude: new Array(length).fill(0),
            }
            totals.set(key, total)
        }
        for (let index = 0; index < length; index += 1)
            total.magnitude[index] =
                (total.magnitude[index] as number) +
                Math.abs(present(each.values[index]) ?? 0)
    }
    const placed: {
        low: (number | undefined)[]
        high: (number | undefined)[]
        stack: string | undefined
    }[] = []
    for (let at = 0; at < series.length; at += 1) {
        const values = (series[at] as Each).values
        const key = keys[at]
        const low: (number | undefined)[] = []
        const high: (number | undefined)[] = []
        const total = key === undefined ? undefined : totals.get(key)
        for (let index = 0; index < length; index += 1) {
            const value = present(values[index])
            if (total === undefined) {
                low.push(undefined)
                high.push(value)
                continue
            }
            // 52.56 — a missing value is zero toward its stack, standing on the positive side.
            const amount = value ?? 0
            const side = amount < 0 ? total.down : total.up
            const from = side[index] as number
            const to = from + amount
            side[index] = to
            // 52.57 — a share of the stack's magnitudes, zero where they sum to nothing.
            const sum = total.magnitude[index] as number
            const share = normalize ? (sum === 0 ? 0 : 1 / sum) : 1
            low.push(from * share)
            high.push(to * share)
        }
        placed.push({ low, high, stack: key })
    }
    return placed
}

/** A value that can be drawn, or `undefined`. */
function present(value: number | null | undefined): number | undefined {
    return value === null || value === undefined || !Number.isFinite(value)
        ? undefined
        : value
}

/**
 * Round values from `min` to `max`, a step of 1, 2 or 5 times a power of ten apart, about `count`
 * intervals: the first and last enclose the range, so they double as the axis's ends.
 */
export function ticks(min: number, max: number, count = 5): number[] {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return []
    const low = Math.min(min, max)
    const high = Math.max(min, max)
    const span = high - low || Math.abs(high) || 1
    const ideal = span / Math.max(1, count)
    const magnitude = 10 ** Math.floor(Math.log10(ideal))
    // The round step nearest the ideal one, compared as ratios: 500K beats 1M for an ideal 585K.
    let step = magnitude
    for (const multiple of [2, 5, 10]) {
        const candidate = multiple * magnitude
        if (
            Math.abs(Math.log(candidate / ideal)) <
            Math.abs(Math.log(step / ideal))
        )
            step = candidate
    }
    const first = Math.floor(low / step) * step
    const last = high === low ? first + 2 * step : Math.ceil(high / step) * step
    const intervals = Math.round((last - first) / step)
    // Rounded to the step's own precision, so float drift never reaches a label.
    const decimals = Math.max(0, -Math.floor(Math.log10(step)))
    const values: number[] = []
    for (let index = 0; index <= intervals; index += 1)
        values.push(Number((first + index * step).toFixed(decimals)))
    return values
}

/**
 * The linear map from `domain` onto `range`. A domain with no width maps every value to the middle
 * of the range.
 */
export function scale(
    domain: readonly [number, number],
    range: readonly [number, number],
): (value: number) => number {
    const [from, to] = domain
    const [start, end] = range
    const width = to - from
    if (width === 0) {
        const middle = (start + end) / 2
        return () => middle
    }
    const factor = (end - start) / width
    return (value) => start + (value - from) * factor
}

/**
 * An SVG path through the points `(xs[i], ys[i])`, broken where `ys[i]` is `null` or `undefined`. A
 * point alone between two gaps is a segment of no length, which a round line cap draws as a dot.
 * Given a `baseline`, each run is closed down to it instead, as an area to fill — back along its own
 * points where it is one per x, as a stacked area closes onto the series under it.
 */
export function path(
    xs: readonly number[],
    ys: readonly (number | null | undefined)[],
    baseline?: number | readonly number[],
): string {
    let path = ''
    let runStart = -1
    const length = Math.min(xs.length, ys.length)
    for (let index = 0; index <= length; index += 1) {
        const y = index < length ? ys[index] : undefined
        const present = y !== null && y !== undefined && Number.isFinite(y)
        if (present) {
            const point = `${round(xs[index] as number)},${round(y)}`
            if (runStart === -1) {
                runStart = index
                path += `M${point}`
            } else path += `L${point}`
            continue
        }
        if (runStart === -1) continue
        if (typeof baseline === 'number')
            path += `L${round(xs[index - 1] as number)},${round(baseline)}L${round(xs[runStart] as number)},${round(baseline)}Z`
        else if (baseline !== undefined) {
            for (let back = index - 1; back >= runStart; back -= 1)
                path += `L${round(xs[back] as number)},${round(baseline[back] ?? 0)}`
            path += 'Z'
        } else if (runStart === index - 1) path += 'Z'
        runStart = -1
    }
    return path
}

/** A coordinate to two places: enough for a pixel, and a path a fraction of the length. */
function round(value: number): number {
    return Math.round(value * 100) / 100
}

/** The index of the position nearest `x`, in positions sorted ascending, the earlier on a tie; `-1` for none. */
export function nearest(positions: readonly number[], x: number): number {
    if (positions.length === 0) return -1
    let low = 0
    let high = positions.length - 1
    while (low < high) {
        const middle = (low + high) >> 1
        if ((positions[middle] as number) < x) low = middle + 1
        else high = middle
    }
    if (low === 0) return 0
    const before = positions[low - 1] as number
    const at = positions[low] as number
    return x - before <= at - x ? low - 1 : low
}
