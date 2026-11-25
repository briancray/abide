import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import CallsByDay from './CallsByDay.abide'

const chart = () => document.querySelector('svg') as SVGSVGElement
const number = (element: Element | undefined, name: string) =>
    Number(element?.getAttribute(name))

// 52.68 — GRIDLINES WITH NO AXIS: the chart spreads its gridlines and no label, and keeps no room for
// one, so the first day's bar stands half a gap in from the left edge and the last's as far from the
// right, and the gridlines run edge to edge.
// THE REVERT: keep room inside the box for the y labels however few are drawn — the first bar stands
// 15 in from where its gap puts it, and the gridlines start at 15.
test('gridlines with no axis keep no room for labels', async () => {
    using _chart = await mount(CallsByDay({}))
    expect(chart().querySelectorAll('[data-chart=tick]')).toHaveLength(0)
    const grids = [...chart().querySelectorAll('[data-chart=grid]')]
    expect(grids.length).toBeGreaterThan(1)
    for (const grid of grids) {
        expect(number(grid, 'x1')).toBe(0)
        expect(number(grid, 'x2')).toBe(600)
    }
    const bars = [...chart().querySelectorAll('[data-chart=bar]')]
    expect(bars).toHaveLength(14)
    // Fourteen slots of 600 / 14, each bar 80% of its slot, centered.
    const slot = 600 / 14
    expect(number(bars[0], 'x')).toBeCloseTo(slot * 0.1)
    const last = bars.at(-1)
    expect(number(last, 'x') + number(last, 'width')).toBeCloseTo(
        600 - slot * 0.1,
    )
})

// 52.26 — WITH NO AXIS, THE READOUT SAYS WHAT A BAR IS: the day and its calls.
// THE REVERT: drop `onpointermove` from the root part — no readout opens.
test('the readout names the day a bar stands for', async () => {
    using _chart = await mount(CallsByDay({}))
    chart().getBoundingClientRect = () => new DOMRect(0, 0, 600, 96)
    chart().dispatchEvent(new PointerEvent('pointermove', { clientX: 0 }))
    flushSync()
    expect(
        [...document.querySelectorAll('[role=tooltip] span')].map(
            (span) => span.textContent,
        ),
    ).toEqual(['Oct 5', 'Calls: 6'])
})
