// 52.29-52.31, 52.33, 52.34, 52.116, 52.119 — A TREND WITH NO AXES, AS PARTS: drawn in units of its own that stretch to
// whatever box the caller gives the `<svg>`, with strokes that do not scale so the line and the end dot
// keep their own width.

import { type Live, live } from '../live.ts'
import { derived } from '../reactive/index.ts'
import { padded, path, percentOf, present, scale } from './index.ts'

/** What `sparkline` draws. A value is read live where a function is given. */
export type SparklineOptions = {
    /** The values in order, drawn left to right. `null` or `undefined` leaves a gap. */
    values: Live<readonly (number | null | undefined)[]>
    /** What the trend shows, as the image's accessible name: `'Won revenue, last 6 months'`. */
    label: Live<string>
    /** Whether the range takes in zero, so a run of zeroes lies along the bottom. `false` by default. */
    zero?: Live<boolean> | undefined
    /** 52.33 — `'bar'` scales the values from zero, as bars are read by their length. `'line'` by default. */
    kind?: Live<'line' | 'bar'> | undefined
    /** Whether the line and the area under it curve through the values (52.105). `false` by default. */
    curve?: Live<boolean> | undefined
    /**
     * The room kept above and below the values, as a share of their span: `0.15`, or `[below, above]`
     * to leave the area room under the line (52.119). None by default.
     */
    pad?: Live<number | readonly [number, number]> | undefined
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
    const drawing = derived(() => {
        const values = live(options.values)
        const zero = live(options.zero) === true
        const kind = live(options.kind) ?? 'line'
        const curve = live(options.curve) === true
        let low = Number.POSITIVE_INFINITY
        let high = Number.NEGATIVE_INFINITY
        let first: number | undefined
        let last: number | undefined
        let lastIndex = -1
        for (let index = 0; index < values.length; index += 1) {
            const value = present(values[index])
            if (value === undefined) continue
            if (value < low) low = value
            if (value > high) high = value
            first ??= value
            last = value
            lastIndex = index
        }
        // 52.119 — padded before zero is taken in.
        ;[low, high] = padded(low, high, live(options.pad))
        if (zero) {
            low = Math.min(low, 0)
            high = Math.max(high, 0)
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
                const value = present(values[index])
                if (value === undefined) continue
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
            // 52.116 — the drawing's units are already hundredths of the box.
            endAt:
                last === undefined
                    ? undefined
                    : `--x: ${percentOf(x(lastIndex), SIZE)}%; --y: ${percentOf(y(last), SIZE)}%`,
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
            get style() {
                return drawing().endAt
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
