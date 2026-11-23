// 52.29-52.31, 52.33, 52.34 — A TREND WITH NO AXES, AS PARTS: drawn in units of its own that stretch to
// whatever box the caller gives the `<svg>`, with strokes that do not scale so the line and the end dot
// keep their own width. `Sparkline` is default markup over these parts (49.9).

import { type Live, live } from '../live.ts'
import { reactive } from '../reactive/index.ts'
import { path, scale } from './index.ts'

/** What `sparkline` draws. A value is read live where a function is given. */
export type SparklineOptions = {
    /** The values in order, drawn left to right. `null` or `undefined` leaves a gap. */
    values: Live<readonly (number | null | undefined)[]>
    /** What the trend shows, as the image's accessible name: `'Won revenue, last 6 months'`. */
    label: Live<string>
    /** Whether the range takes in zero, so a run of zeroes lies along the bottom. `false` by default. */
    zero?: Live<boolean>
    /** 52.33 — `'bar'` scales the values from zero, as bars are read by their length. `'line'` by default. */
    kind?: Live<'line' | 'bar'>
    /** Whether the line and the area under it curve through the values (52.106). `false` by default. */
    curve?: Live<boolean>
}

/** The parts `sparkline` hands back, each spread onto an element of its own. */
export type SparklineParts = {
    /** The `<svg>`: its stretched units, its role, its name and `data-trend` (52.31). */
    readonly svg: Record<string, unknown>
    /** `<path {...trend.line} />`: the line through the values, broken where one is missing. */
    readonly line: Record<string, unknown>
    /** `<path {...trend.area} />`: the area under the line. */
    readonly area: Record<string, unknown>
    /** `<path {...trend.bars} />`: each value a bar up from zero (52.33). */
    readonly bars: Record<string, unknown>
    /** `<path {...trend.dot} />`: a mark at the last value. */
    readonly dot: Record<string, unknown>
    /** `up`, `down` or `flat`: the last present value against the first (52.31). */
    get trend(): 'up' | 'down' | 'flat'
    /** Whether there is a last value to mark. */
    get ended(): boolean
}

// The drawing's own units. `preserveAspectRatio="none"` stretches them to the box.
const SIZE = 100

/** A trend with no axes, stretched to its box, as parts to spread. */
export function sparkline(options: SparklineOptions): SparklineParts {
    const drawing = reactive(() => {
        const values = live(options.values)
        const zero = live(options.zero) === true
        const kind = live(options.kind) ?? 'line'
        const curve = live(options.curve) === true
        let low = zero ? 0 : Number.POSITIVE_INFINITY
        let high = zero ? 0 : Number.NEGATIVE_INFINITY
        let first: number | undefined
        let last: number | undefined
        let lastIndex = -1
        for (let index = 0; index < values.length; index += 1) {
            const value = values[index]
            if (
                value === null ||
                value === undefined ||
                !Number.isFinite(value)
            )
                continue
            if (value < low) low = value
            if (value > high) high = value
            first ??= value
            last = value
            lastIndex = index
        }
        // 52.34 — a range of zero alone has no width, and is drawn as zero to one.
        if (zero && low === high) high = 1
        const x = scale([0, Math.max(1, values.length - 1)], [0, SIZE])
        // 52.33 — a bar is read by its length, so zero is on the scale however far the values sit from it.
        const y =
            kind === 'bar'
                ? scale([Math.min(low, 0), Math.max(high, 0)], [SIZE, 0])
                : scale([low, high], [SIZE, 0])
        let bars = ''
        if (kind === 'bar' && values.length > 0) {
            const band = SIZE / values.length
            const gap = band * 0.2
            const baseline = y(0)
            for (let index = 0; index < values.length; index += 1) {
                const value = values[index]
                if (
                    value === null ||
                    value === undefined ||
                    !Number.isFinite(value)
                )
                    continue
                const left = index * band + gap / 2
                bars += `M${left},${baseline}H${left + band - gap}V${y(value)}H${left}Z`
            }
        }
        const xs: number[] = []
        const ys: (number | undefined)[] = []
        for (let index = 0; index < values.length; index += 1) {
            const value = values[index]
            xs.push(x(index))
            ys.push(
                value === null || value === undefined ? undefined : y(value),
            )
        }
        return {
            bars,
            line: path(xs, ys, { curve }),
            area: path(xs, ys, { baseline: SIZE, curve }),
            end: last === undefined ? '' : `M${x(lastIndex)},${y(last)}Z`,
            trend:
                first === undefined || last === undefined || last === first
                    ? ('flat' as const)
                    : last > first
                      ? ('up' as const)
                      : ('down' as const),
        }
    })

    return {
        svg: {
            'data-sparkline': 'svg',
            viewBox: `0 0 ${SIZE} ${SIZE}`,
            preserveAspectRatio: 'none',
            overflow: 'visible',
            role: 'img',
            get 'aria-label'() {
                return live(options.label)
            },
            get 'data-trend'() {
                return drawing().trend
            },
        },
        line: {
            'data-sparkline': 'line',
            get d() {
                return drawing().line
            },
            fill: 'none',
            stroke: 'currentColor',
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
            'vector-effect': 'non-scaling-stroke',
        },
        area: {
            'data-sparkline': 'area',
            get d() {
                return drawing().area
            },
            fill: 'currentColor',
            'fill-opacity': '0.15',
            stroke: 'none',
        },
        bars: {
            'data-sparkline': 'bar',
            get d() {
                return drawing().bars
            },
            fill: 'currentColor',
            stroke: 'none',
        },
        dot: {
            'data-sparkline': 'dot',
            get d() {
                return drawing().end
            },
            fill: 'none',
            stroke: 'currentColor',
            'stroke-width': '4',
            'stroke-linecap': 'round',
            'vector-effect': 'non-scaling-stroke',
        },
        get trend() {
            return drawing().trend
        },
        get ended() {
            return drawing().end !== ''
        },
    }
}
