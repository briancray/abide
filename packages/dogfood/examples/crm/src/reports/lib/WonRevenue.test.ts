import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import WonRevenue from './WonRevenue.abide'

const chart = () => document.querySelector('svg') as SVGSVGElement
const texts = (selector: string) =>
    [...document.querySelectorAll(selector)].map((node) => node.textContent)

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

// 52.26, 52.27, 50.47 — THE READOUT OPENS IN THE PAGE'S `Tooltips` as the crosshair's bound hint,
// beside it on the side with more of the plot. THE REVERTS: open it on the `'top'` side the hint
// defaults to — `data-side` reads 'top' where 'right' is due; and have `tooltip` ignore `trigger` —
// no pointer rests on the crosshair, so the popover never opens.
test('the crosshair reads each line at the nearest month', async () => {
    using _chart = await mount(WonRevenue({}))
    const tip = () => document.querySelector('[role=tooltip]') as HTMLElement
    pointAt(1)
    expect(chart().hasAttribute('data-hovering')).toBe(true)
    expect(tip().matches(':popover-open')).toBe(true)
    expect(tip().getAttribute('data-side')).toBe('right')
    expect(texts('[role=tooltip] [data-part=readout] > span')).toEqual([
        'Jul 2026',
        'Won: $25K',
        'Target: $22K',
    ])
    pointAt(2)
    expect(texts('[data-part=readout-value]')).toEqual([
        'Won: —',
        'Target: $24K',
    ])
    pointAt(5)
    expect(texts('[data-part=readout-value]')).toEqual([
        'Won: $42K',
        'Target: $30K',
    ])
    expect(tip().getAttribute('data-side')).toBe('left')
    // A pointer moving inside one month's reach redraws nothing.
    const work = measure(() => {
        chart().dispatchEvent(new PointerEvent('pointermove', { clientX: 590 }))
        flushSync()
    })
    atMost(work, { nodesCreated: 0, attributesSet: 0 })
    chart().dispatchEvent(new PointerEvent('pointerleave'))
    flushSync()
    expect(chart().hasAttribute('data-hovering')).toBe(false)
    expect(tip().matches(':popover-open')).toBe(false)
})

// 52.34 — held by `chart.ticks`, which widens a range of no width. THE REVERT: have `ticks` answer
// `[low]` for one — the line runs across the middle of the plot, at 116 where 216 is due.
test('a series of zeroes is drawn along the bottom of a chart that takes zero in', async () => {
    using _chart = await mount(
        WonRevenue({ won: [0, 0, 0], target: [0, 0, 0] }),
    )
    const won = chart().querySelector("[data-part=line][data-series='0']")
    const heights = new Set(
        [...(won?.getAttribute('d') ?? '').matchAll(/,([\d.]+)/g)].map(
            (match) => match[1],
        ),
    )
    expect([...heights]).toEqual(['216'])
})
