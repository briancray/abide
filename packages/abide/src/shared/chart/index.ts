// The `chart` namespace: the arithmetic under a chart, apart from any one way of drawing it — round
// ticks, a linear scale, a path that breaks where a value is missing, series piled into stacks, and
// the point nearest the pointer. `chart`, `pie` and `sparkline` draw with it, and so can a chart of
// your own.

/** One series of a chart: what it is called, its values in x order, how it is drawn, and its stack. */
export type Series = {
    /** What the series is called, in the readout. */
    label: string
    /** One value per x position. `null` or `undefined` is a value missing there. */
    values: readonly (number | null | undefined)[]
    /** How `chart` draws it: a line, a column per value, or a filled area. `'line'` by default. */
    kind?: 'line' | 'column' | 'area'
    /** The stack it piles into with the series naming the same one, or `false` for none (52.54). */
    stack?: string | false
    /** Whether a line or an area is drawn as a curve through its values (52.105). `false` by default. */
    curve?: boolean
}

/**
 * 52.53-52.57 — where each series stands at each x once the stacks are piled: `high` is the value
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
    // A stack's running totals per x, the positive side and the negative one apart (52.53), and the
    // sum of its magnitudes per x for 52.56.
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
            // 52.55 — a missing value is zero toward its stack, standing on the positive side.
            const amount = value ?? 0
            const side = amount < 0 ? total.down : total.up
            const from = side[index] as number
            const to = from + amount
            side[index] = to
            // 52.56 — a share of the stack's magnitudes, zero where they sum to nothing.
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
 * points where it is one per x, as a stacked area closes onto the series under it. Given `curve`,
 * each run is a monotone cubic through its points (52.104), and so is the way back along a baseline.
 */
export function path(
    xs: readonly number[],
    ys: readonly (number | null | undefined)[],
    options: {
        /** Where each run closes down to, as an area to fill: one y, or one per x. */
        baseline?: number | readonly number[]
        /** Whether each run curves through its points rather than running straight. */
        curve?: boolean
    } = {},
): string {
    const { baseline, curve = false } = options
    let path = ''
    let runStart = -1
    const length = Math.min(xs.length, ys.length)
    for (let index = 0; index <= length; index += 1) {
        const y = index < length ? ys[index] : undefined
        if (y !== null && y !== undefined && Number.isFinite(y)) {
            if (runStart === -1) runStart = index
            continue
        }
        if (runStart === -1) continue
        const last = index - 1
        path += `M${round(xs[runStart] as number)},${round(ys[runStart] as number)}`
        path += run(xs, ys as readonly number[], runStart, last, curve)
        if (typeof baseline === 'number')
            path += `L${round(xs[last] as number)},${round(baseline)}L${round(xs[runStart] as number)},${round(baseline)}Z`
        else if (baseline !== undefined) {
            const floors: number[] = []
            for (let at = runStart; at <= last; at += 1)
                floors.push(baseline[at] ?? 0)
            path += `L${round(xs[last] as number)},${round(floors[floors.length - 1] as number)}`
            path += run(xs, floors, runStart, last, curve, -runStart, true)
            path += 'Z'
        } else if (runStart === last) path += 'Z'
        runStart = -1
    }
    return path
}

/**
 * The segments from the point at `first` to the one at `last`, the pen already at one end: straight,
 * or a monotone cubic (52.104). `ys` is read at `index + offset`, so a run's own copy of its baseline
 * can be walked by the indices of `xs`; `backward` draws from `last` to `first`.
 */
function run(
    xs: readonly number[],
    ys: readonly number[],
    first: number,
    last: number,
    curve: boolean,
    offset = 0,
    backward = false,
): string {
    let segments = ''
    if (!curve || last - first < 2) {
        if (backward)
            for (let at = last - 1; at >= first; at -= 1)
                segments += `L${round(xs[at] as number)},${round(ys[at + offset] as number)}`
        else
            for (let at = first + 1; at <= last; at += 1)
                segments += `L${round(xs[at] as number)},${round(ys[at + offset] as number)}`
        return segments
    }
    // Fritsch-Carlson: a tangent per point, zero at a turn and never steeper than twice the gentler
    // secant beside it, so each cubic's control points lie between the two values it joins.
    const count = last - first
    const secants: number[] = []
    for (let at = first; at < last; at += 1) {
        const width = (xs[at + 1] as number) - (xs[at] as number)
        secants.push(
            width === 0
                ? 0
                : ((ys[at + 1 + offset] as number) -
                      (ys[at + offset] as number)) /
                      width,
        )
    }
    const tangents: number[] = [0]
    for (let step = 1; step < count; step += 1) {
        const before = secants[step - 1] as number
        const after = secants[step] as number
        const widthBefore =
            (xs[first + step] as number) - (xs[first + step - 1] as number)
        const widthAfter =
            (xs[first + step + 1] as number) - (xs[first + step] as number)
        const weighted =
            (before * widthAfter + after * widthBefore) /
            (widthBefore + widthAfter || 1)
        tangents.push(
            (Math.sign(before) + Math.sign(after)) *
                Math.min(
                    Math.abs(before),
                    Math.abs(after),
                    0.5 * Math.abs(weighted),
                ),
        )
    }
    // An end's tangent is the one a parabola through it and its neighbour's tangent would have.
    tangents[0] = (3 * (secants[0] as number) - (tangents[1] as number)) / 2
    tangents.push(
        (3 * (secants[count - 1] as number) - (tangents[count - 1] as number)) /
            2,
    )
    if (backward)
        for (let at = last - 1; at >= first; at -= 1)
            segments += cubic(xs, ys, tangents, at + 1, at, first, offset)
    else
        for (let at = first + 1; at <= last; at += 1)
            segments += cubic(xs, ys, tangents, at - 1, at, first, offset)
    return segments
}

/** The cubic from the point at `from` to the one at `to`, each leaving along its tangent. */
function cubic(
    xs: readonly number[],
    ys: readonly number[],
    tangents: readonly number[],
    from: number,
    to: number,
    first: number,
    offset: number,
): string {
    const fromX = xs[from] as number
    const toX = xs[to] as number
    const fromY = ys[from + offset] as number
    const toY = ys[to + offset] as number
    const third = (toX - fromX) / 3
    return `C${round(fromX + third)},${round(fromY + (tangents[from - first] as number) * third)} ${round(toX - third)},${round(toY - (tangents[to - first] as number) * third)} ${round(toX)},${round(toY)}`
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
