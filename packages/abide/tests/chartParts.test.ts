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
// app draws with `plot.x` and `plot.y` lines up with the ones the parts hand back.
// THE REVERT: push a point for a missing value too — four points where three are due.
test("every present value is a point at the plot's own x and y", () => {
    const plot = chart({
        label: 'Won',
        series: () => [{ label: 'Won', values: [10, null, 30, 20] }],
    })
    const points = plot.points
    expect(points.map((point) => point.index)).toEqual([0, 2, 3])
    for (const point of points) {
        expect(point.x).toBe(plot.x(point.index))
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
    expect(plot.svg['aria-describedby']).toBeUndefined()
    press(plot.svg, 'ArrowRight')
    const first = plot.crosshair?.line['bind:element']
    expect(plot.crosshair?.index).toBe(0)
    press(plot.svg, 'ArrowRight')
    expect(plot.crosshair?.index).toBe(1)
    expect(plot.crosshair?.line['bind:element']).toBe(first)
    expect(plot.svg['aria-describedby']).toBe(plot.tip.id)
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
        inner: () => inner(),
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
        curve: () => curved(),
    })
    expect(String(trend.line.d).match(/C/g)).toHaveLength(4)
    expect(String(trend.area.d).match(/C/g)).toHaveLength(4)
    curved.set(false)
    expect(String(trend.line.d)).not.toContain('C')
})
