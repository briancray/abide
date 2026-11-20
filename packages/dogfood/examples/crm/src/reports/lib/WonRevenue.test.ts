import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import LineChart from '@abide/abide/LineChart.abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import WonRevenue from './WonRevenue.abide'

const chart = () => document.querySelector('svg') as SVGSVGElement
const texts = (selector: string) =>
    [...chart().querySelectorAll(selector)].map((node) => node.textContent)

// Laid out 600 wide: a DOM with no layout measures every box as empty.
function pointAt(month: number) {
    chart().getBoundingClientRect = () => new DOMRect(0, 0, 600, 240)
    chart().dispatchEvent(
        new PointerEvent('pointermove', { clientX: (month / 5) * 600 }),
    )
    flushSync()
}

test('won revenue is a line broken where a month has no total', async () => {
    using _chart = await mount(WonRevenue({}))
    expect(chart().getAttribute('aria-label')).toBe(
        'Won revenue against target, June to November',
    )
    const won = chart().querySelector("[data-part=line][data-series='0']")
    expect(won?.getAttribute('d')?.match(/M/g)).toHaveLength(2)
    expect(texts('[data-axis=x]')).toEqual([
        'Jun 2026',
        'Jul 2026',
        'Sep 2026',
        'Oct 2026',
        'Nov 2026',
    ])
    expect(texts('[data-axis=y]')).toEqual([
        '$0',
        '$10K',
        '$20K',
        '$30K',
        '$40K',
        '$50K',
    ])
})

test('the crosshair reads each line at the nearest month', async () => {
    using _chart = await mount(WonRevenue({}))
    pointAt(3)
    expect(chart().hasAttribute('data-hovering')).toBe(true)
    expect(texts('[data-part=readout] tspan')).toEqual([
        'Sep 2026',
        'Won: $31K',
        'Target: $26K',
    ])
    pointAt(2)
    expect(texts('[data-part=readout-value]')).toEqual([
        'Won: —',
        'Target: $24K',
    ])
    pointAt(4)
    // From one month to the next, the readout's nodes are the ones it had.
    const work = measure(() => pointAt(5))
    expect(texts('[data-part=readout] tspan')).toEqual([
        'Nov 2026',
        'Won: $42K',
        'Target: $30K',
    ])
    atMost(work, { nodesCreated: 0 })
    chart().dispatchEvent(new PointerEvent('pointerleave'))
    flushSync()
    expect(chart().hasAttribute('data-hovering')).toBe(false)
})

// 52.32 — held by `chart.ticks`, which widens a range of no width. THE REVERT: have `ticks` answer
// `[low]` for one — the y ticks are `['0']` alone, and the line runs across the middle.
test('a series of zeroes is drawn along the bottom of a chart that takes zero in', async () => {
    using _chart = await mount(
        LineChart({
            series: [{ label: 'Won', values: [0, 0, 0] }],
            label: 'Won revenue',
            zero: true,
            yTicks: 2,
        }),
    )
    expect(
        texts('[data-part=tick][data-axis=y]').map((text) => text?.trim()),
    ).toEqual(['0', '0.5', '1'])
})
