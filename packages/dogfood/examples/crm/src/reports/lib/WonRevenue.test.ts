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

// 52.35 — A BAR SERIES IS A BAR PER VALUE from zero, and no line. THE REVERT: draw every series as a
// line — no `bar` parts, `bars: 0` where `3` is due.
test('a bar series draws a bar per value from zero, in place of a line', async () => {
    using _chart = await mount(
        LineChart({
            series: [
                { label: 'Deals won', values: [2, 4, null, 1], kind: 'bar' },
            ],
            label: 'Deals won by month',
            zero: true,
        }),
    )
    const bars = [...chart().querySelectorAll('[data-part=bar]')]
    expect(`bars: ${bars.length}`).toBe('bars: 3')
    expect(chart().querySelector('[data-part=line]')).toBeNull()
    const heights = bars.map((bar) => Number(bar.getAttribute('height')))
    expect(heights[1]).toBeCloseTo((heights[0] as number) * 2)
    expect(heights[1]).toBeCloseTo((heights[2] as number) * 4)
})

// 52.36, 52.37 — A CLICK PICKS THE NEAREST X, save one `disabled` holds for, which is marked. THE
// REVERT: drop the `disabled` check in `pick` — the click on November picks it, `[1, 5]` where `[1]`
// is due.
test('a click picks the nearest month, and a disabled one is marked and takes no pick', async () => {
    const picked: number[] = []
    using _chart = await mount(
        LineChart({
            series: [{ label: 'Won', values: [1, 2, 3, 4, 5, 6] }],
            label: 'Won revenue',
            onpick: (index) => picked.push(index),
            disabled: (index) => index === 5,
        }),
    )
    const click = (month: number) => {
        chart().getBoundingClientRect = () => new DOMRect(0, 0, 600, 240)
        chart().dispatchEvent(
            new MouseEvent('click', { clientX: (month / 5) * 600 }),
        )
        flushSync()
    }
    click(1)
    click(5)
    expect(picked).toEqual([1])
    pointAt(5)
    expect(
        chart()
            .querySelector('[data-part=readout]')
            ?.hasAttribute('data-disabled'),
    ).toBe(true)
})
