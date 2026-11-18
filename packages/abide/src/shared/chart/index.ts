// The `chart` namespace: the arithmetic under a chart, apart from any one way of drawing it — round
// ticks, a linear scale, a path that breaks where a value is missing, and the point nearest the
// pointer. `LineChart` and `Sparkline` draw with it, and so can a chart of your own.

/** One line of a chart: what it is called, and its values in x order, `null` where one is missing. */
export type Series = {
    /** What the line is called, in the readout and the accessible description. */
    label: string
    /** One value per x position. `null` or `undefined` leaves a gap in the line. */
    values: readonly (number | null | undefined)[]
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
 * Given a `baseline`, each run is closed down to it instead, as an area to fill.
 */
export function path(
    xs: readonly number[],
    ys: readonly (number | null | undefined)[],
    baseline?: number,
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
        if (baseline !== undefined)
            path += `L${round(xs[index - 1] as number)},${round(baseline)}L${round(xs[runStart] as number)},${round(baseline)}Z`
        else if (runStart === index - 1) path += 'Z'
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
