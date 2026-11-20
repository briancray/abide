import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import DealFlow from './DealFlow.abide'

const chart = () => document.querySelector('svg') as SVGSVGElement
const texts = (selector: string) =>
    [...document.querySelectorAll(selector)].map((node) => node.textContent)
// A column's place and size, read off the transform that draws its unit rect (52.64).
function bars(series: number) {
    return [
        ...chart().querySelectorAll(`[data-part=bar][data-series='${series}']`),
    ].map((bar) => {
        const [x = 0, y = 0, width = 0, height = 0] = (
            (bar as SVGElement).style.transform.match(/-?[\d.]+/g) ?? []
        ).map(Number)
        return { x, y, width, height }
    })
}
function check(name: string) {
    const box = [...document.querySelectorAll('label')]
        .find((label) => label.textContent?.trim() === name)
        ?.querySelector('input') as HTMLInputElement
    box.click()
    flushSync()
}
// Laid out 600 wide: a DOM with no layout measures every box as empty.
function pointAt(clientX: number) {
    chart().getBoundingClientRect = () => new DOMRect(0, 0, 600, 240)
    chart().dispatchEvent(new PointerEvent('pointermove', { clientX }))
    flushSync()
}

// 52.69 — THE Y LABELS STAND LEFT OF THE PLOT, and the first month's column starts right of where the
// gridlines do. THE REVERT: start the plot at 0 — the gridlines run under the labels from 0.
test('no column is drawn over a y label', async () => {
    using _flow = await mount(DealFlow({}))
    const start = Number(
        chart().querySelector('[data-part=grid]')?.getAttribute('x1'),
    )
    expect(start).toBeGreaterThan(0)
    for (const bar of [...bars(0), ...bars(1)])
        expect(bar.x).toBeGreaterThanOrEqual(start)
})

// 52.37 — COLUMNS IN NO STACK STAND SIDE BY SIDE in their month's slot, each up from zero, and a
// missing month has none. THE REVERT: give every column the first band — Lost stands on Won's x.
test('won and lost stand side by side in each month', async () => {
    using _flow = await mount(DealFlow({}))
    const won = bars(0)
    const lost = bars(1)
    expect(won).toHaveLength(5)
    expect(lost).toHaveLength(5)
    for (let month = 0; month < 5; month += 1) {
        const left = won[month] as (typeof won)[0]
        const right = lost[month] as (typeof lost)[0]
        expect(right.x).toBeCloseTo(left.x + left.width)
        expect(left.y + left.height).toBe(216)
        expect(right.y + right.height).toBe(216)
    }
    expect(texts('[data-axis=y]')[0]).toBe('0')
})

// 52.59 — STACKED, LOST STANDS ON WON. THE REVERT: draw each column from zero whatever its stack —
// Lost's foot is at 216 where Won's top is due.
test('stacked, lost stands on top of won in one column', async () => {
    using _flow = await mount(DealFlow({ stacked: true }))
    const won = bars(0)
    const lost = bars(1)
    for (let month = 0; month < 5; month += 1) {
        const under = won[month] as (typeof won)[0]
        const over = lost[month] as (typeof lost)[0]
        expect(over.x).toBeCloseTo(under.x)
        expect(over.y + over.height).toBeCloseTo(under.y)
    }
})

// 52.60, 52.61 — AS SHARES, EVERY MONTH REACHES THE TOP, the axis reads percentages and the readout
// reads each count and its share. THE REVERT: write the ticks with `yFormat` — '0.5' where '50%'.
test('as shares, every month fills the column and reads its share', async () => {
    using _flow = await mount(DealFlow({ shares: true }))
    expect(texts('[data-axis=y]')).toEqual([
        '0%',
        '20%',
        '40%',
        '60%',
        '80%',
        '100%',
    ])
    for (const top of bars(1)) expect(top.y).toBeCloseTo(16)
    pointAt(0)
    expect(texts('[data-part=readout-value]')).toEqual([
        'Won: 4 (57.1%)',
        'Lost: 3 (42.9%)',
    ])
})

// 52.63 — A TOGGLE MOVES THE COLUMNS IT HAS, so a CSS transition eases each from one place to the
// next: what it creates is the two gridlines the taller range needs, and no column. THE REVERT: key
// the marks `by mark`, a record made fresh each run — 36 nodes where 12 are due, and not one column
// is the element it was.
test('stacking moves the columns rather than redrawing them', async () => {
    using _flow = await mount(DealFlow({}))
    const before = [...chart().querySelectorAll('[data-part=bar]')]
    const work = measure(() => check('Stack'))
    atMost(work, { nodesCreated: 12 })
    const after = [...chart().querySelectorAll('[data-part=bar]')]
    expect(after.every((bar, at) => bar === before[at])).toBe(true)
    expect(bars(1)[0]?.y).not.toBe(141)
})

// 52.38, 52.39 — A CLICK PICKS ITS MONTH, save the one whose books are open, which is marked. THE
// REVERT: drop the `disabled` check in `pick` — November is picked too.
test('a click opens its month, and November takes no pick', async () => {
    using _flow = await mount(DealFlow({}))
    const click = (clientX: number) => {
        chart().getBoundingClientRect = () => new DOMRect(0, 0, 600, 240)
        chart().dispatchEvent(new MouseEvent('click', { clientX }))
        flushSync()
    }
    click(130)
    expect(document.querySelector('p')?.textContent).toBe(
        'Deals closed in Jul 2026',
    )
    click(590)
    expect(document.querySelector('p')?.textContent).toBe(
        'Deals closed in Jul 2026',
    )
    pointAt(590)
    expect(
        document
            .querySelector('[data-part=readout]')
            ?.hasAttribute('data-disabled'),
    ).toBe(true)
})
