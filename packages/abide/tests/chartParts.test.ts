import { expect, test } from 'bun:test'

import { chart } from '../src/shared/chart/chart.ts'
import { pie } from '../src/shared/chart/pie.ts'
import { sparkline } from '../src/shared/chart/sparkline.ts'
import { reactive } from '../src/shared/reactive/index.ts'

const press = (svg: Record<string, unknown>, key: string) =>
    (svg.onkeydown as (event: KeyboardEvent) => void)(
        new KeyboardEvent('keydown', { key }),
    )

// 52.78 — A POINT STANDS WHERE THE PLOT'S OWN SCALE PUTS ITS VALUE, one per present value, so a mark an
// app draws with `plot.x` and `plot.y` lines up with the ones the parts hand back, and `plot.x` places a
// value between two positions — a date no value was recorded on.
// THE REVERTS: push a point for a missing value too — four points where three are due; and map `x` by
// index — `plot.x(2)` stands at the third position, 30, where a fifth of the way to 10 is due.
test("every present value is a point at the plot's own x and y", () => {
    const POSITIONS = [0, 10, 30, 40]
    const plot = chart({
        label: 'Won',
        series: () => [{ label: 'Won', values: [10, null, 30, 20] }],
        x: POSITIONS,
    })
    const points = plot.points
    expect(points.map((point) => point.index)).toEqual([0, 2, 3])
    expect(plot.x(20)).toBeCloseTo((plot.x(10) + plot.x(30)) / 2)
    expect(plot.x(2)).toBeCloseTo(plot.x(0) + (plot.x(10) - plot.x(0)) / 5)
    for (const point of points) {
        expect(point.x).toBe(plot.x(POSITIONS[point.index] ?? 0))
        expect(point.y).toBe(plot.y(point.value))
        expect(point.circle.cx).toBe(point.x)
    }
})

// 52.79, 50.46 — THE CROSSHAIR IS BOUND ONCE, at every x, and the chart is described by its readout's
// `tip` while the crosshair stands. THE REVERT: hand back a binding per x — the second month's is not
// the first's, and a crosshair kept as one element is unbound and bound again at every move.
test('the crosshair carries one binding at every x, and the chart is described by its tip', () => {
    const plot = chart({
        label: 'Won',
        series: () => [{ label: 'Won', values: [10, 20, 30] }],
    })
    expect(plot.crosshair).toBeUndefined()
    expect(plot.root['aria-describedby']).toBeUndefined()
    press(plot.root, 'ArrowRight')
    const first = plot.crosshair?.line['bind:element']
    expect(plot.crosshair?.index).toBe(0)
    press(plot.root, 'ArrowRight')
    expect(plot.crosshair?.index).toBe(1)
    expect(plot.crosshair?.line['bind:element']).toBe(first)
    expect(plot.root['aria-describedby']).toBe(plot.tip.id)
    expect(plot.tip.role).toBe('tooltip')
})

// 52.80 — A SLICE'S HINT IS BOUND ONCE WHILE ITS WORDS STAND: a sweep that eases rewrites the slice's
// style and binds nothing again.
// THE REVERT: make the hint's binding afresh each time the slices are drawn — the hole moving binds again.
test("a slice's hint binding stands while its words do", () => {
    const inner = reactive(0)
    const ring = pie({
        label: 'Stages',
        slices: [
            { label: 'Lead', value: 3 },
            { label: 'Won', value: 1 },
        ],
        inner: () => inner.get(),
    })
    const before = ring.slices[0]?.circle
    inner.set(0.6)
    const after = ring.slices[0]?.circle
    expect(after?.['stroke-width']).not.toBe(before?.['stroke-width'])
    expect(after?.['bind:element']).toBe(before?.['bind:element'])
})

// THE REVERT: leave `curve` out of what `sparkline` hands `path` — the line and the area are straight,
// four `L`s and no `C`.
test('a sparkline declaring curve draws its line and its area curved — 52.105', () => {
    const curved = reactive(true)
    const trend = sparkline({
        values: [3, 7, 4, 9, 6],
        label: 'Won revenue',
        curve: () => curved.get(),
    })
    expect(String(trend.line.d).match(/C/g)).toHaveLength(4)
    expect(String(trend.area.d).match(/C/g)).toHaveLength(4)
    curved.set(false)
    expect(String(trend.line.d)).not.toContain('C')
})

// 52.116 — EVERY PLACED MARK CARRIES ITS PLACE AS A SHARE OF THE BOX, so an element placed by
// `left: var(--x)` stands where the SVG one does at whatever size the box is laid out.
// THE REVERTS: write the bar's vars in px of the box rather than percentages — `--x: 33.5%` reads
// `--x: 201px`; and leave `--x` off an x gridline — its vars read `{}`.
test('a placed mark carries where it stands as percentages of the box', () => {
    const plot = chart({
        label: 'Deals',
        series: () => [
            { label: 'Won', values: [4, 8], kind: 'column' },
            { label: 'Target', values: [5, 6] },
        ],
    })
    const vars = (part: Record<string, unknown> | undefined) =>
        Object.fromEntries(
            [...String(part?.style).matchAll(/--([a-z]+): (-?[\d.]+)%/g)].map(
                (match) => [match[1], Number(match[2])],
            ),
        )
    const share = (px: number, whole: number) =>
        Math.round((px / whole) * 10_000) / 100
    for (const point of plot.points)
        expect(vars(point.circle)).toEqual({
            x: share(point.x, 600),
            y: share(point.y, 240),
        })
    for (const bar of plot.bars)
        expect(vars(bar.rect)).toEqual({
            x: share(bar.x, 600),
            y: share(bar.y, 240),
            width: share(bar.width, 600),
            height: share(bar.height, 240),
        })
    for (const tick of plot.yTicks) {
        expect(vars(tick.grid)).toEqual({ y: share(tick.y, 240) })
        expect(vars(tick.text)).toEqual({ x: 0, y: share(tick.y, 240) })
    }
    for (const tick of plot.xTicks) {
        expect(vars(tick.grid)).toEqual({ x: share(tick.x, 600) })
        expect(vars(tick.text).x).toBe(share(tick.x, 600))
    }
    press(plot.root, 'ArrowRight')
    expect(vars(plot.crosshair?.line)).toEqual({
        x: share(plot.crosshair?.x ?? 0, 600),
    })
    const trend = sparkline({ values: [3, 7, 5], label: 'Won' })
    expect(vars(trend.dot)).toEqual({ x: 100, y: 50 })
})

// 52.116, 52.63 — AN `<svg>` ROOT'S MARKS ARE PLACED BY THEIR ATTRIBUTES ALONE: the vars are a `style`
// per mark no rule reads there, 45% of a 600-mark redraw (`bench:chart-vars`), so they leave once the
// root is bound to one, and a column is its rect's own geometry rather than a transform.
// THE REVERT: write the vars whatever the root is — every point carries a `style` on an `<svg>`.
test("an svg root's marks carry no vars, and a div root's do", () => {
    const drawn = (root: Element) => {
        const plot = chart({
            label: 'Deals',
            series: () => [
                { label: 'Won', values: [4, 8], kind: 'column' },
                { label: 'Target', values: [5, 6] },
            ],
        })
        const stop = (
            plot.root['bind:element'] as (element: Element) => () => void
        )(root)
        const parts = [
            ...plot.points.map((point) => point.circle),
            ...plot.bars.map((bar) => bar.rect),
            ...plot.yTicks.map((tick) => tick.grid),
        ]
        const bar = plot.bars[0]
        stop()
        return { styles: parts.map((part) => part.style), bar }
    }
    const svg = drawn(
        document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    )
    expect(svg.styles.every((style) => style === undefined)).toBe(true)
    expect(svg.bar?.rect.y).toBe(svg.bar?.y)
    expect(svg.bar?.rect.height).toBe(svg.bar?.height)
    const div = drawn(document.createElement('div'))
    expect(div.styles.every((style) => String(style).includes('--'))).toBe(true)
})

// 52.68 — THE PLOT IS THE WHOLE BOX, whatever its labels say: a point stands at the same share of the
// box under a label of forty characters as under one of one, the gridlines run edge to edge, and the
// extremes of the range stand on the box's top and bottom.
// THE REVERT: keep room inside the box for the longest y label — the first point moves right from 0.
test('the plot spans the box, and no label moves a mark', () => {
    const drawn = (yFormat: (value: number) => string) =>
        chart({
            label: 'Won',
            series: () => [{ label: 'Won', values: [10, 20, 30] }],
            yFormat,
        })
    const short = drawn(() => '1')
    const long = drawn((value) => `${value}`.padStart(40, '$'))
    expect(long.points.map((point) => [point.x, point.y])).toEqual(
        short.points.map((point) => [point.x, point.y]),
    )
    expect(long.points[0]?.x).toBe(0)
    expect(long.points.at(-1)?.x).toBe(600)
    for (const tick of long.yTicks) {
        expect([tick.grid.x1, tick.grid.x2]).toEqual([0, 600])
        expect(tick.text.x).toBe(0)
    }
    expect(long.y(10)).toBe(240)
    expect(long.y(30)).toBe(0)
    expect(long.xTicks[0]?.text.y).toBe(240)
})

// 52.119 — `pad` KEEPS THE VALUES OFF THE EDGES: the range widens by a share of its span before the
// ticks round it, before zero is taken in, so a column still stands on zero, and a flat range is not
// widened. THE REVERT: drop `padded` from `chart` and `sparkline` — the ticks end at 10 and 20, on the
// values, and the trend's low runs along the bottom.
test('pad widens the range of the values by a share of its span, before zero is taken in', () => {
    const ticks = (pad: number, kind: 'line' | 'column' = 'line') =>
        chart({
            label: 'Won',
            series: () => [{ label: 'Won', values: [10, 20], kind }],
            pad,
        }).yTicks.map((tick) => tick.value)
    expect(ticks(0)).toEqual([10, 12, 14, 16, 18, 20])
    expect(ticks(0.15)).toEqual([5, 10, 15, 20, 25])
    expect(ticks(0.5, 'column')[0]).toBe(0)
    const trend = sparkline({ values: [0, 10], label: 'Won', pad: [0.5, 0] })
    expect(String(trend.line.d)).toBe('M0,66.67L100,0')
    const flat = sparkline({ values: [4, 4], label: 'Won', pad: 0.2 })
    expect(String(flat.line.d)).toBe('M0,50L100,50')
})

// 52.120 — AN X AXIS BY VALUE: given `xAxis: 'values'`, the x ticks are the round values `chart.ticks`
// answers inside the x range, each a gridline down the plot and a label at its bottom edge where `x`
// places the value, labeling no position; by default they label the positions themselves.
// THE REVERT: read `xAxis` nowhere — the ticks are the positions again, [3, 9, 30, 45, 90].
test('an x axis by value stands its ticks at round values, each a gridline and a label', () => {
    const DAYS = [3, 9, 14, 30, 45, 90]
    const drawn = (xAxis?: 'values') =>
        chart({
            label: 'Close rate',
            series: () => [
                { label: 'Close rate', values: [62, 48, 41, 30, 22, 9] },
            ],
            x: DAYS,
            xAxis,
            xFormat: (days) => `${days}d`,
        })
    const plot = drawn('values')
    expect(plot.xTicks.map((tick) => tick.value)).toEqual([20, 40, 60, 80])
    for (const tick of plot.xTicks) {
        expect(tick.index).toBeUndefined()
        expect(tick.x).toBe(plot.x(tick.value))
        expect(tick.label).toBe(`${tick.value}d`)
        expect(tick.grid).toMatchObject({
            'data-chart': 'grid',
            'data-axis': 'x',
            x1: tick.x,
            x2: tick.x,
            y1: 0,
            y2: 240,
        })
        expect(tick.text).toMatchObject({ x: tick.x, y: 240 })
    }
    const byPosition = drawn().xTicks
    expect(byPosition.map((tick) => tick.value)).toEqual([3, 9, 30, 45, 90])
    expect(byPosition.map((tick) => tick.index)).toEqual([0, 1, 3, 4, 5])
})

// 52.121, 52.25 — `xZero` TAKES ZERO INTO THE X RANGE and draws a line down the plot there, as `zero`
// does across it; a range `bounds` gives stays as given.
// THE REVERT: leave zero out of the x range — `plot.x(0)` stands at -300, off the plot's left edge.
test('xZero takes zero into the x range, with a line down the plot there', () => {
    const drawn = (xZero: boolean, bounds?: { x: [number, number] }) =>
        chart({
            label: 'Won',
            series: () => [{ label: 'Won', values: [10, 20, 30] }],
            x: [2, 4, 6],
            xZero,
            bounds,
        })
    expect(drawn(false).xZero).toBeUndefined()
    const plot = drawn(true)
    expect(plot.x(0)).toBe(0)
    expect(plot.xZero?.x).toBe(0)
    expect(plot.xZero?.line).toMatchObject({
        'data-chart': 'zero',
        'data-axis': 'x',
        x1: 0,
        x2: 0,
        y1: 0,
        y2: 240,
    })
    expect(drawn(true, { x: [1, 6] }).x(1)).toBe(0)
})

// 52.122 — THE ROOT FILLS ITS CONTAINER AND THE GUESS DRAWS WHERE THE MEASURED DRAWING WILL, so a
// server-rendered root paints its left edge and its labels in place and only its x grows once measured.
// THE REVERTS: hand back `viewBox: 0 0 width height` — the browser's `xMidYMid meet` shrinks the guess
// and centres it, and the key is on the root; write the measured width back as `width` — 600, and a
// root with no CSS of its own never grows past its guess.
// 52.123 — `measured`, and `data-measured` on the root, stand from the first measurement, even one equal to the guess. THE REVERT: seed
// the size with the guess — the equal measurement is not written, and `measured` stays false.
test("a chart's root fills its container, carries no viewBox, and answers measured once measured", () => {
    const plot = chart({
        label: 'Won',
        series: () => [{ label: 'Won', values: [1, 2] }],
        height: 224,
    })
    expect('viewBox' in plot.root).toBe(false)
    expect(plot.root.width).toBe('100%')
    expect(plot.root.height).toBe(224)
    expect(plot.measured).toBe(false)
    // The shared observer is made on the first observe and dropped once it observes nothing (32.98),
    // so a stand-in installed here is the one asked, and every earlier test has unbound its root.
    let deliver: ((entries: unknown[]) => void) | undefined
    const real = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
        constructor(delivered: (entries: unknown[]) => void) {
            deliver = delivered
        }
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const stop = (plot.root['bind:element'] as (element: Element) => () => void)(svg)
    try {
        expect(plot.measured).toBe(false)
        expect(plot.root['data-measured']).toBeUndefined()
        deliver?.([{ target: svg, contentRect: { width: 600, height: 224 } }])
        expect(plot.measured).toBe(true)
        expect(plot.root['data-measured']).toBe('')
        expect(plot.root.width).toBe('100%')
    } finally {
        stop()
        globalThis.ResizeObserver = real
    }
})
