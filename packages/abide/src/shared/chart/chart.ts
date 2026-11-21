// 52.24-52.30, 52.34, 52.37-52.39, 52.51-52.53, 52.59-52.64, 52.69-52.72 — A CHART AS PARTS: series over
// one pair of axes, handed back as the geometry each mark is drawn at and as parts an app spreads onto
// SVG elements of its own — `{#for point of plot.points()}<circle {...point.circle} r="3" />` — with the
// `<svg>`'s part measuring it, scrubbing a crosshair by pointer and keyboard, and its readout opened
// against the crosshair in an element of the app's own. `Chart` is default markup over these parts (49.9). Callable, with the
// arithmetic it draws with as its members, as `reactive` carries `reactive.share`: `chart.ticks` and the
// rest are what a chart of one's own draws with where even these parts are too much.

import { anchored } from '../anchored.ts'
import { announce } from '../announce.ts'
import { stack } from '../dismissible.ts'
import { number, percent } from '../format/index.ts'
import { type Live, live } from '../live.ts'
import { size as observeSize } from '../observe/size.ts'
import { randomToken } from '../randomToken.ts'
import { reactive, watch } from '../reactive/index.ts'
import type { Disposer } from '../reactive/watch.ts'
import { scrub } from '../scrub.ts'
import {
    nearest,
    path,
    scale,
    type Series,
    stack as stackSeries,
    ticks,
} from './index.ts'

/** What `chart` draws and how. A value is read live where a function is given. */
export type ChartOptions = {
    /** What the chart shows, as its accessible name: `'Won revenue by month'`. */
    label: Live<string>
    /** The series drawn, in order, the first at the back (52.24). */
    series: () => readonly Series[]
    /** The x of each position, ascending: a time in epoch milliseconds, say. Indices by default. */
    x?: Live<readonly number[] | undefined>
    /** Writes an x for its tick and the readout: `format.date`, say. `format.number` by default. */
    xFormat?: (x: number) => string
    /** Writes a value for the y ticks and the readout: `format.money`, say. `format.number` by default. */
    yFormat?: (y: number) => string
    /** The most x positions labeled under the plot. 5 by default. */
    xTicks?: Live<number>
    /** About how many intervals the y gridlines divide the range into. 4 by default. */
    yTicks?: Live<number>
    /** Whether the y range takes in zero, with a line drawn there. `false` by default. */
    zero?: Live<boolean>
    /** Whether a series with no `stack` of its own piles into one stack with the others (52.55). `false` by default. */
    stack?: Live<boolean>
    /** Whether each stack is drawn as shares of its total at each x (52.57, 52.60). `false` by default. */
    normalize?: Live<boolean>
    /** The range each axis spans, in place of the range of the values (52.62). */
    bounds?: Live<
        | {
              x?: readonly [number, number]
              y?: readonly [number, number]
          }
        | undefined
    >
    /** The width drawn at before the `<svg>` is measured. 600 by default. */
    width?: number
    /** The height drawn at before the `<svg>` is measured. 240 by default. */
    height?: number
    /** Called with the x position nearest a click, or the crosshair's on Enter, where `disabled` does not hold for it (52.38, 52.71). */
    onpick?: (index: number) => void
    /** Whether an x position takes no pick, written as `data-disabled` on its bars and the readout (52.39). */
    disabled?: (index: number) => boolean
}

/** The edges of the plot, inside the room the axis labels take. */
export type ChartFrame = {
    left: number
    top: number
    right: number
    bottom: number
}

/** A y gridline and its label. */
export type ChartYTick = {
    value: number
    y: number
    label: string
    /** The gridline across the plot: `<line {...tick.grid} />`. */
    grid: Record<string, unknown>
    /** The label left of the plot: `<text {...tick.text}>{tick.label}</text>`. */
    text: Record<string, unknown>
}

/** An x position labeled under the plot. */
export type ChartXTick = {
    index: number
    x: number
    label: string
    /** `<text {...tick.text}>{tick.label}</text>`. */
    text: Record<string, unknown>
}

/** One column of a series at one x. */
export type ChartBar = {
    /** Stable across a redraw: `series:index`, so `{#for bar of plot.bars() by bar.key}` keeps each element. */
    key: string
    series: number
    index: number
    value: number
    x: number
    y: number
    width: number
    height: number
    /** A unit rect placed and sized by its `style`'s transform (52.64): `<rect {...bar.rect} />`. */
    rect: Record<string, unknown>
}

/** One series' mark: a line or an area as a path, or columns as bars. */
export type ChartMark = {
    series: number
    label: string
    kind: 'line' | 'column' | 'area'
    /** The path's `d`, empty for columns. */
    d: string
    /** `<path {...mark.path} />` — for a line or an area. */
    path: Record<string, unknown>
    /** `<g {...mark.columns}>` — the element holding a `column`'s bars. */
    columns: Record<string, unknown>
    /** The columns, for a `column`. */
    bars: ChartBar[]
}

/** A present value of a series, where it stands. */
export type ChartPoint = {
    key: string
    series: number
    index: number
    value: number
    x: number
    y: number
    /** `<circle {...point.circle} r="3" />`. */
    circle: Record<string, unknown>
}

/** What the readout reads at the x the crosshair stands at. */
export type ChartReadout = {
    index: number
    x: number
    /** The x, as `xFormat` writes it. */
    label: string
    disabled: boolean
    /** The element holding the x's label. */
    heading: Record<string, unknown>
    /** Each series' value there: its label, its value as written, and its point where it has one. */
    values: {
        series: number
        label: string
        value: string
        y: number | undefined
        /** The series' point at the crosshair, `undefined` where it has no value there. */
        circle: Record<string, unknown> | undefined
        /** The element holding the series' label and value. */
        text: Record<string, unknown>
    }[]
}

/** The parts `chart` hands back. Each list is read live; each part is spread onto an element of your own. */
export type ChartParts = {
    /** The `<svg>`: its size, measured (52.24), its name, focus, and the pointer and keys that move the crosshair (52.26, 52.70). */
    readonly svg: Record<string, unknown>
    /** The x of position `index`. */
    x(index: number): number
    /** The y of `value`. */
    y(value: number): number
    /** The edges of the plot. */
    get frame(): ChartFrame
    /** The y gridlines and their labels. */
    get yTicks(): ChartYTick[]
    /** The x positions labeled under the plot. */
    get xTicks(): ChartXTick[]
    /** The line at zero, where `zero` is set (52.25). */
    get zero(): { y: number; line: Record<string, unknown> } | undefined
    /** Every series' mark in order, the first at the back (52.24). */
    get marks(): ChartMark[]
    /** The marks drawn as lines. */
    get lines(): ChartMark[]
    /** The marks drawn as areas. */
    get areas(): ChartMark[]
    /** Every column of every series. */
    get bars(): ChartBar[]
    /** Every present value of every series. */
    get points(): ChartPoint[]
    /** What the readout reads, while the crosshair stands somewhere. */
    get readout(): ChartReadout | undefined
    /** The crosshair while it stands somewhere: `<line {...plot.crosshair?.line} />`. */
    get crosshair():
        { index: number; x: number; line: Record<string, unknown> } | undefined
    /**
     * 50.47 — the readout's popover, spread onto an element of the app's own outside the `<svg>` and
     * rendered while `readout` stands: opened against the crosshair, describing the chart.
     */
    readonly tip: Record<string, unknown>
}

// Room over the top gridline for its label, and under the plot for the x labels.
const TOP = 16
const BOTTOM = 24
// The room left of the plot per character of the longest y label, and between that label and the plot:
// a label is laid out before the chart can measure its text, so the room is the width of a character in
// the small type a chart is set in, and a longer one runs into the plot rather than being cut off.
const CHARACTER = 7
const GUTTER = 8
// The share of an x's slot its columns fill, the rest the gap between one x and the next.
const BAND = 0.8

/** A chart over one pair of axes, as its geometry and the parts to draw it with. */
export function chart(options: ChartOptions): ChartParts {
    const xFormat = options.xFormat ?? ((value: number) => number(value))
    const yFormat = options.yFormat ?? ((value: number) => number(value))
    const size = reactive({
        width: options.width ?? 600,
        height: options.height ?? 240,
    })
    const hovered = reactive(-1)
    // The width the `<svg>` was last measured at, read without following it.
    const measuredWidth = () => size.peek()?.width ?? 0

    const plot = reactive(() => {
        const series = options.series()
        const normalize = live(options.normalize) === true
        const zero = live(options.zero) === true
        const bounds = live(options.bounds)
        const given = live(options.x)
        const { width, height } = size()
        const placed = stackSeries(series, {
            stack: live(options.stack) === true,
            normalize,
        })
        let length = 0
        for (const each of series) length = Math.max(length, each.values.length)
        const positions: number[] = []
        for (let index = 0; index < length; index += 1)
            positions.push(given?.[index] ?? index)
        // 52.34, 52.37 — zero is in the range where it is asked for and where a column rises from it.
        let low = Number.POSITIVE_INFINITY
        let high = Number.NEGATIVE_INFINITY
        let columns = false
        for (let at = 0; at < series.length; at += 1) {
            if (series[at]?.kind === 'column') columns = true
            const { low: lows, high: highs } = placed[at] as (typeof placed)[0]
            for (let index = 0; index < length; index += 1) {
                for (const value of [lows[index], highs[index]]) {
                    if (value === undefined) continue
                    if (value < low) low = value
                    if (value > high) high = value
                }
            }
        }
        if (zero || columns) {
            low = Math.min(low, 0)
            high = Math.max(high, 0)
        }
        if (low > high) {
            low = 0
            high = 1
        }
        // 52.62 — bounds span the axis exactly, and the gridlines are the round values inside them.
        const yBounds = bounds?.y
        let gridValues = ticks(
            yBounds?.[0] ?? low,
            yBounds?.[1] ?? high,
            live(options.yTicks) ?? 4,
        )
        if (yBounds !== undefined)
            gridValues = gridValues.filter(
                (value) => value >= yBounds[0] && value <= yBounds[1],
            )
        const floor = yBounds?.[0] ?? gridValues[0] ?? low
        const ceiling = yBounds?.[1] ?? gridValues.at(-1) ?? high
        const bottom = height - BOTTOM
        // 52.60 — under `normalize` the axis is shares, whatever the values are written as.
        const gridLabels: string[] = []
        let longest = 0
        for (const value of gridValues) {
            const label = normalize ? percent(value) : yFormat(value)
            gridLabels.push(label)
            longest = Math.max(longest, label.length)
        }
        // 52.69 — the plot starts right of the y labels, so no mark is drawn over one.
        const left = longest === 0 ? 0 : longest * CHARACTER + GUTTER
        // Columns are centered on their x, so the first and last stand a half slot in from the edges.
        const slot = (width - left) / Math.max(1, length)
        const inset = columns ? slot / 2 : 0
        const toX = scale(
            bounds?.x ?? [positions[0] ?? 0, positions.at(-1) ?? 0],
            [left + inset, width - inset],
        )
        const toY = scale([floor, ceiling], [bottom, TOP])
        const xs: number[] = []
        for (const position of positions) xs.push(toX(position))
        // Where a column rises from and an area in no stack fills down to: zero, or the edge nearer it.
        const base = toY(Math.min(Math.max(0, floor), ceiling))
        // 52.37 — A BAND OF EACH X'S SLOT PER STACK OF COLUMNS, and one per column in none.
        const bands = new Map<string, number>()
        let bandCount = 0
        for (let at = 0; at < series.length; at += 1) {
            if (series[at]?.kind !== 'column') continue
            const key = placed[at]?.stack
            if (key === undefined) bandCount += 1
            else if (!bands.has(key)) bands.set(key, bandCount++)
        }
        const bandWidth = bandCount === 0 ? 0 : (slot * BAND) / bandCount
        const marks: ChartMark[] = []
        const points: ChartPoint[] = []
        const ysOf: (number | undefined)[][] = []
        let ownBand = bands.size
        for (let at = 0; at < series.length; at += 1) {
            const each = series[at] as Series
            const {
                low: lows,
                high: highs,
                stack: key,
            } = placed[at] as (typeof placed)[0]
            const kind = each.kind ?? 'line'
            // A point stands at the series' own value: none where it is missing.
            const ys: (number | undefined)[] = []
            for (let index = 0; index < length; index += 1) {
                const value = each.values[index]
                const top = highs[index]
                const y =
                    value === null || value === undefined || top === undefined
                        ? undefined
                        : toY(top)
                ys.push(y)
                if (y !== undefined)
                    points.push(
                        pointOf(at, index, value as number, xs[index] ?? 0, y),
                    )
            }
            ysOf.push(ys)
            const bars: ChartBar[] = []
            let drawn = ''
            if (kind === 'line') drawn = path(xs, ys)
            else if (kind === 'area') {
                // 52.52 — a stacked area closes onto the series under it, through a missing value too.
                if (key === undefined) drawn = path(xs, ys, base)
                else {
                    const tops: number[] = []
                    const floors: number[] = []
                    for (let index = 0; index < length; index += 1) {
                        tops.push(toY(highs[index] ?? 0))
                        floors.push(toY(lows[index] ?? 0))
                    }
                    drawn = path(xs, tops, floors)
                }
            } else {
                const band =
                    key === undefined ? ownBand++ : (bands.get(key) as number)
                for (let index = 0; index < length; index += 1) {
                    const top = ys[index]
                    if (top === undefined) continue
                    const from =
                        lows[index] === undefined
                            ? base
                            : toY(lows[index] as number)
                    const barLeft =
                        (xs[index] ?? 0) - (slot * BAND) / 2 + band * bandWidth
                    bars.push(
                        barOf(
                            at,
                            index,
                            each.values[index] as number,
                            barLeft,
                            Math.min(top, from),
                            bandWidth,
                            Math.abs(from - top),
                        ),
                    )
                }
            }
            marks.push({
                series: at,
                label: each.label,
                kind,
                d: drawn,
                path:
                    kind === 'line'
                        ? {
                              'data-part': 'line',
                              'data-series': at,
                              d: drawn,
                              fill: 'none',
                              stroke: 'currentColor',
                              'stroke-linejoin': 'round',
                              'stroke-linecap': 'round',
                          }
                        : {
                              'data-part': 'area',
                              'data-series': at,
                              d: drawn,
                              fill: 'currentColor',
                              stroke: 'none',
                          },
                columns: { 'data-part': 'columns', 'data-series': at },
                bars,
            })
        }
        const yTickList: ChartYTick[] = []
        for (let index = 0; index < gridValues.length; index += 1) {
            const value = gridValues[index] as number
            const y = toY(value)
            yTickList.push({
                value,
                y,
                label: gridLabels[index] as string,
                grid: {
                    'data-part': 'grid',
                    x1: left,
                    x2: width,
                    y1: y,
                    y2: y,
                    stroke: 'currentColor',
                    'stroke-opacity': '0.2',
                },
                text: {
                    'data-part': 'tick',
                    'data-axis': 'y',
                    x: 0,
                    y,
                    'dominant-baseline': 'middle',
                    fill: 'currentColor',
                },
            })
        }
        const xTickList: ChartXTick[] = []
        const shown = Math.min(length, Math.max(1, live(options.xTicks) ?? 5))
        for (let step = 0; step < shown; step += 1) {
            const index =
                shown === 1
                    ? 0
                    : Math.round((step * (length - 1)) / (shown - 1))
            const x = xs[index] ?? 0
            xTickList.push({
                index,
                x,
                label: xFormat(positions[index] ?? index),
                text: {
                    'data-part': 'tick',
                    'data-axis': 'x',
                    x,
                    y: bottom + 6,
                    'text-anchor':
                        shown === 1 || columns
                            ? 'middle'
                            : step === 0
                              ? 'start'
                              : step === shown - 1
                                ? 'end'
                                : 'middle',
                    'dominant-baseline': 'hanging',
                    fill: 'currentColor',
                },
            })
        }
        const zeroY = toY(0)
        return {
            series,
            placed,
            positions,
            xs,
            ysOf,
            marks,
            points,
            yTicks: yTickList,
            xTicks: xTickList,
            frame: { left, top: TOP, right: width, bottom },
            toX,
            toY,
            zero: zero
                ? {
                      y: zeroY,
                      line: {
                          'data-part': 'zero',
                          x1: left,
                          x2: width,
                          y1: zeroY,
                          y2: zeroY,
                          stroke: 'currentColor',
                      },
                  }
                : undefined,
        }
    })

    function pointOf(
        series: number,
        index: number,
        value: number,
        x: number,
        y: number,
    ): ChartPoint {
        return {
            key: `${series}:${index}`,
            series,
            index,
            value,
            x,
            y,
            circle: {
                'data-part': 'point',
                'data-series': series,
                cx: x,
                cy: y,
                fill: 'currentColor',
            },
        }
    }

    function barOf(
        series: number,
        index: number,
        value: number,
        x: number,
        y: number,
        width: number,
        height: number,
    ): ChartBar {
        return {
            key: `${series}:${index}`,
            series,
            index,
            value,
            x,
            y,
            width,
            height,
            rect: {
                'data-part': 'bar',
                'data-series': series,
                'data-disabled':
                    options.disabled?.(index) === true ? '' : undefined,
                width: '1',
                height: '1',
                // 52.64 — a unit rect placed and sized by a transform, which a CSS transition eases.
                style: `transform: translate(${x}px, ${y}px) scale(${width}, ${height})`,
                fill: 'currentColor',
            },
        }
    }

    // What the readout reads at the x the crosshair is on.
    const readout = reactive((): ChartReadout | undefined => {
        const index = hovered()
        const drawn = plot()
        if (index < 0 || index >= drawn.xs.length) return undefined
        const at = drawn.xs[index] ?? 0
        const normalize = live(options.normalize) === true
        const values: ChartReadout['values'] = []
        for (let line = 0; line < drawn.series.length; line += 1) {
            const value = drawn.series[line]?.values[index]
            const place = drawn.placed[line]
            let written =
                value === null || value === undefined ? '—' : yFormat(value)
            // 52.61 — a stacked value under `normalize` reads its share beside it.
            if (normalize && place?.stack !== undefined && written !== '—')
                written += ` (${percent(Math.abs((place.high[index] ?? 0) - (place.low[index] ?? 0)))})`
            const y = drawn.ysOf[line]?.[index]
            values.push({
                series: line,
                label: drawn.series[line]?.label ?? '',
                value: written,
                y,
                circle:
                    y === undefined
                        ? undefined
                        : {
                              'data-part': 'point',
                              'data-series': line,
                              cx: at,
                              cy: y,
                              r: '3',
                              fill: 'currentColor',
                          },
                text: { 'data-part': 'readout-value', 'data-series': line },
            })
        }
        return {
            index,
            x: at,
            label: xFormat(drawn.positions[index] ?? index),
            disabled: options.disabled?.(index) === true,
            heading: { 'data-part': 'readout-x' },
            values,
        }
    })

    // 52.26, 52.70 — the crosshair's x, picked by the pointer or the arrows.
    const scrubbing = scrub(
        { peek: () => hovered.peek(), set: (index) => hovered.set(index) },
        {
            count: () => plot().xs.length,
            nearest: (fraction) =>
                nearest(plot().xs, fraction * measuredWidth()),
        },
    )

    // 52.38, 52.71 — a click picks the x nearest it, read again from the click's own position, and Enter
    // the x the crosshair stands at.
    function pick(index: number | undefined) {
        if (options.onpick === undefined) return
        if (
            index === undefined ||
            index < 0 ||
            options.disabled?.(index) === true
        )
            return
        options.onpick(index)
    }

    function key(event: KeyboardEvent) {
        if (event.key === 'Enter') return pick(hovered.peek())
        const before = hovered.peek()
        scrubbing.key(event)
        // 52.72 — a move the keys make is read out, its readout being nowhere the reader is: a pointer's
        // move is not, since the pointer's own readout is in front of it and a sweep would read every x.
        const read = readout.peek()
        if (hovered.peek() === before || read === undefined) return
        announce(written(read))
    }

    // The readout as text, for the announcement.
    const written = (read: ChartReadout): string => {
        const parts = [read.label]
        for (const point of read.values)
            parts.push(`${point.label}: ${point.value}`)
        return parts.join(', ')
    }

    // 50.47 — THE READOUT SHOWS AGAINST THE CROSSHAIR: the line standing is held here, so a crosshair an
    // app keeps as one element and one keyed by its x both carry the readout along, and the readout's
    // own element is placed against whichever line stands.
    const line = reactive<Element | undefined>(undefined)
    const holdLine = (element: Element): Disposer => {
        line.set(element)
        return () => {
            if (line.peek() === element) line.set(undefined)
        }
    }
    // Hydration runs setup again (41.6), and the chart's `aria-describedby` is bound to it.
    const tipId = `chart-tip-${randomToken(4, 'hex')}`
    const holdTip = (element: HTMLElement): Disposer =>
        watch(() => {
            const anchor = line()
            // Read tracked, so a crosshair kept as one element is placed again at each x.
            const read = readout()
            if (anchor === undefined) return
            const stop = anchored(
                anchor,
                element,
                {
                    // 52.27 — the side with more of the plot.
                    side:
                        read !== undefined && read.x >= measuredWidth() / 2
                            ? 'left'
                            : 'right',
                    offset: 8,
                    // 50.48 — a readout is never the pointer's target.
                    interactive: false,
                },
                (placement) =>
                    element.setAttribute('data-side', placement.side),
            )
            // 50.25 — an Escape no one prevented takes the crosshair down, as it does a hint.
            const unstack = stack({
                element: anchor,
                dismiss: scrubbing.leave,
                escape: true,
                outside: false,
                inside: [],
            })
            return () => {
                unstack()
                stop()
            }
        })

    const measure = observeSize(size)

    return {
        svg: {
            'data-part': 'svg',
            get width() {
                return size().width
            },
            get height() {
                return size().height
            },
            get viewBox() {
                const { width, height } = size()
                return `0 0 ${width} ${height}`
            },
            role: 'img',
            get 'aria-label'() {
                return live(options.label)
            },
            get 'data-hovering'() {
                return readout() === undefined ? undefined : ''
            },
            get 'aria-describedby'() {
                return readout() === undefined ? undefined : tipId
            },
            tabindex: '0',
            'bind:element': measure,
            onpointermove: scrubbing.move,
            onpointerleave: scrubbing.leave,
            onfocusout: scrubbing.leave,
            onkeydown: key,
            onclick: (event: MouseEvent) => pick(scrubbing.indexAt(event)),
        },
        x: (index) => plot().xs[index] ?? plot().toX(index),
        y: (value) => plot().toY(value),
        get frame() {
            return plot().frame
        },
        get yTicks() {
            return plot().yTicks
        },
        get xTicks() {
            return plot().xTicks
        },
        get zero() {
            return plot().zero
        },
        get marks() {
            return plot().marks
        },
        get lines() {
            return plot().marks.filter((mark) => mark.kind === 'line')
        },
        get areas() {
            return plot().marks.filter((mark) => mark.kind === 'area')
        },
        get bars() {
            return plot().marks.flatMap((mark) => mark.bars)
        },
        get points() {
            return plot().points
        },
        get readout() {
            return readout()
        },
        tip: {
            id: tipId,
            role: 'tooltip',
            popover: 'manual',
            'data-part': 'readout',
            get 'data-disabled'() {
                return readout()?.disabled === true ? '' : undefined
            },
            'bind:element': holdTip,
        },
        get crosshair() {
            const read = readout()
            if (read === undefined) return undefined
            const { frame } = plot()
            return {
                index: read.index,
                x: read.x,
                line: {
                    'data-part': 'crosshair',
                    x1: read.x,
                    x2: read.x,
                    y1: frame.top,
                    y2: frame.bottom,
                    stroke: 'currentColor',
                    'bind:element': holdLine,
                },
            }
        },
    }
}

chart.ticks = ticks
chart.scale = scale
chart.path = path
chart.stack = stackSeries
chart.nearest = nearest

// The namespace's one type, as `chart.Series` names it.
export declare namespace chart {
    /** One series of a chart: what it is called, its values in x order, how it is drawn, and its stack. */
    export type Series = import('./index.ts').Series
}
