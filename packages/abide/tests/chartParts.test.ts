import { expect, test } from 'bun:test'

import { chart } from '../src/shared/chart/chart.ts'
import { pie } from '../src/shared/chart/pie.ts'
import { reactive } from '../src/shared/reactive/index.ts'

const press = (svg: Record<string, unknown>, key: string) =>
    (svg.onkeydown as (event: KeyboardEvent) => void)(
        new KeyboardEvent('keydown', { key }),
    )

// 52.79 — A POINT STANDS WHERE THE PLOT'S OWN SCALE PUTS ITS VALUE, one per present value, so a mark an
// app draws with `plot.x` and `plot.y` lines up with the ones the parts hand back.
// THE REVERT: push a point for a missing value too — four points where three are due.
test("every present value is a point at the plot's own x and y", () => {
    const plot = chart({
        label: 'Won',
        series: () => [{ label: 'Won', values: [10, null, 30, 20] }],
    })
    const points = plot.points()
    expect(points.map((point) => point.index)).toEqual([0, 2, 3])
    for (const point of points) {
        expect(point.x).toBe(plot.x(point.index))
        expect(point.y).toBe(plot.y(point.value))
        expect(point.circle.cx).toBe(point.x)
    }
})

// 52.80 — A CROSSHAIR IS BOUND ONCE PER X IT STANDS AT: an app keeping it as one element has its readout
// opened again where it moves to, and a crosshair redrawn at the same x binds nothing again.
// THE REVERT: hand back one binding for every x — the binding at the second month is the first's.
test('the crosshair carries one binding per x it stands at', () => {
    const plot = chart({
        label: 'Won',
        series: () => [{ label: 'Won', values: [10, 20, 30] }],
    })
    expect(plot.crosshair()).toBeUndefined()
    press(plot.svg, 'ArrowRight')
    const first = plot.crosshair()?.line['bind:element']
    expect(plot.crosshair()?.index).toBe(0)
    expect(plot.crosshair()?.line['bind:element']).toBe(first)
    press(plot.svg, 'ArrowRight')
    expect(plot.crosshair()?.index).toBe(1)
    expect(plot.crosshair()?.line['bind:element']).not.toBe(first)
})

// 52.81 — A SLICE'S HINT IS BOUND ONCE WHILE ITS WORDS STAND: a sweep that eases rewrites the slice's
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
    const before = ring.slices()[0]?.circle
    inner.set(0.6)
    const after = ring.slices()[0]?.circle
    expect(after?.['stroke-width']).not.toBe(before?.['stroke-width'])
    expect(after?.['bind:element']).toBe(before?.['bind:element'])
})
