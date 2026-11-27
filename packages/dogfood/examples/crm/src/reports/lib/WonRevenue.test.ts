import { expect, test } from 'bun:test'

import { announce, flushSync } from '@abide/abide'
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
    const won = chart().querySelector("[data-chart=line][data-series='0']")
    expect(won?.getAttribute('d')?.match(/M/g)).toHaveLength(2)
    expect(texts('[data-chart=tick][data-axis=x]')).toEqual([
        'Jun 2026',
        'Jul 2026',
        'Sep 2026',
        'Oct 2026',
        'Nov 2026',
    ])
    expect(texts('[data-chart=tick][data-axis=y]')).toEqual([
        '$0',
        '$10K',
        '$20K',
        '$30K',
        '$40K',
        '$50K',
    ])
})

// 52.26, 52.27, 50.46 — THE READOUT OPENS IN THE CHART'S `tip` against the crosshair, beside it on the
// side with more of the plot, and describes the chart. THE REVERTS: open it on the `'top'` side a hint
// defaults to — `data-side` reads 'top' where 'right' is due; and drop the `tip`'s binding — the
// popover never opens.
test('the crosshair reads each line at the nearest month — 52.28', async () => {
    using _chart = await mount(WonRevenue({}))
    const tip = () => document.querySelector('[role=tooltip]') as HTMLElement
    pointAt(1)
    expect(chart().hasAttribute('data-hovering')).toBe(true)
    expect(tip().matches(':popover-open')).toBe(true)
    expect(tip().getAttribute('data-side')).toBe('right')
    expect(texts('[role=tooltip] > span')).toEqual([
        'Jul 2026',
        'Won: $25K',
        'Target: $22K',
    ])
    pointAt(2)
    expect(texts('[data-chart=readout-value]')).toEqual([
        'Won: —',
        'Target: $24K',
    ])
    pointAt(5)
    expect(texts('[data-chart=readout-value]')).toEqual([
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
    // The readout's element leaves with the crosshair.
    expect(tip()).toBeNull()
})

// 52.34 — held by `chart.ticks`, which widens a range of no width. THE REVERT: have `ticks` answer
// `[low]` for one — the line runs across the middle of the plot, at 120 where 240 is due.
test('a series of zeroes is drawn along the bottom of a chart that takes zero in', async () => {
    using _chart = await mount(
        WonRevenue({ won: [0, 0, 0], target: [0, 0, 0] }),
    )
    const won = chart().querySelector("[data-chart=line][data-series='0']")
    const heights = new Set(
        [...(won?.getAttribute('d') ?? '').matchAll(/,([\d.]+)/g)].map(
            (match) => match[1],
        ),
    )
    expect([...heights]).toEqual(['240'])
})

/** A key pressed on the chart, bubbling to the document as a browser's does. */
function press(key: string) {
    chart().dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
    flushSync()
}

// 52.69, 50.46 — THE CHART READS FROM THE KEYBOARD: it takes focus, the arrows step the crosshair one
// month at a time and stop at the ends, Home and End go to the first and the last, the readout
// describes the chart while it shows, and an Escape — or focus leaving — puts the crosshair away.
// THE REVERTS: drop `onkeydown` from the chart — no arrow opens the readout; let `roving` wrap — the
// arrow past November reads June; and describe the crosshair rather than the chart — the chart names
// no description.
test('the arrows step the crosshair month by month, and Escape puts it away', async () => {
    using _chart = await mount(WonRevenue({}))
    const tip = () => document.querySelector('[role=tooltip]') as HTMLElement
    const month = () => texts('[role=tooltip] [data-chart=readout-x]')[0]
    expect(chart().getAttribute('tabindex')).toBe('0')
    press('ArrowRight')
    expect(month()).toBe('Jun 2026')
    expect(chart().getAttribute('aria-describedby')).toBe(tip().id)
    press('ArrowRight')
    expect(month()).toBe('Jul 2026')
    press('End')
    expect(month()).toBe('Nov 2026')
    press('ArrowRight')
    expect(month()).toBe('Nov 2026')
    press('Home')
    expect(month()).toBe('Jun 2026')
    press('Escape')
    expect(chart().hasAttribute('data-hovering')).toBe(false)
    // The readout's element leaves with the crosshair.
    expect(tip()).toBeNull()
    expect(chart().hasAttribute('aria-describedby')).toBe(false)
    press('ArrowLeft')
    expect(month()).toBe('Nov 2026')
    chart().dispatchEvent(new FocusEvent('focusout'))
    flushSync()
    expect(chart().hasAttribute('data-hovering')).toBe(false)
})

const said = (part: 'polite' | 'assertive') =>
    document.querySelector(`[data-announce=${part}]`)?.textContent ?? ''

// 52.71 — A MOVE THE KEYS MAKE IS READ OUT, and a pointer's is not: the keyboard's reader has no
// readout in front of them, and a pointer sweeping the plot would read every month it crossed.
// THE REVERT: drop the `announce` from `chart`'s key handler, and the region stays empty.
test("a move the keys make is read out, and a pointer's is not", async () => {
    using _chart = await mount(WonRevenue({}))
    announce('Ready')
    flushSync()
    pointAt(1)
    expect(said('polite')).toBe('Ready')
    press('ArrowRight')
    expect(said('polite')).toBe('Aug 2026, Won: —, Target: $24K')
    press('End')
    expect(said('polite')).toBe('Nov 2026, Won: $42K, Target: $30K')
    pointAt(2)
    expect(said('polite')).toBe('Nov 2026, Won: $42K, Target: $30K')
})

// 50.51, 50.52 — THE SAME WORDS SAID TWICE ARE READ TWICE, each landing as an element of its own, and a
// message replaces the last rather than joining a log. THE REVERT: key the message by its text rather
// than its count, and the second `Saved` lands on the element the first did — nothing for a screen
// reader to read.
test('the same words said twice land twice, each replacing the last', async () => {
    using _chart = await mount(WonRevenue({}))
    const region = document.querySelector(
        '[data-announce=polite]',
    ) as HTMLElement
    expect(region.getAttribute('aria-live')).toBe('polite')
    announce('Saved')
    flushSync()
    const first = region.firstElementChild
    announce('Saved')
    flushSync()
    expect(region.children).toHaveLength(1)
    expect(region.firstElementChild).not.toBe(first)
    expect(said('polite')).toBe('Saved')
    announce('Connection lost', { politeness: 'assertive' })
    flushSync()
    expect([said('polite'), said('assertive')]).toEqual(['', 'Connection lost'])
})

// 52.78 — AN APP'S OWN MARKS OVER `chart`'S PARTS: a dot at every month won, standing on the line the
// parts draw, and none for August's open books.
// THE REVERT: hand back a point for a missing value too — six dots where five are due.
test('every month won is marked by a dot of its own, on the line', async () => {
    using _chart = await mount(WonRevenue({}))
    const dots = [
        ...chart().querySelectorAll(
            "circle[data-chart=point][data-series='0']",
        ),
    ]
    expect(dots).toHaveLength(5)
    // The path's corners, which it writes to two places.
    const corners = [
        ...(
            chart()
                .querySelector("[data-chart=line][data-series='0']")
                ?.getAttribute('d') ?? ''
        ).matchAll(/(-?[\d.]+),(-?[\d.]+)/g),
    ].map((match) => [Number(match[1]), Number(match[2])])
    for (const dot of dots) {
        const [x, y] = [
            Number(dot.getAttribute('cx')),
            Number(dot.getAttribute('cy')),
        ]
        expect(
            corners.some(
                ([cx = 0, cy = 0]) =>
                    Math.abs(cx - x) < 0.01 && Math.abs(cy - y) < 0.01,
            ),
        ).toBe(true)
    }
})
