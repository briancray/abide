import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import PipelineTrend from './PipelineTrend.abide'

const chart = () => document.querySelector('svg') as SVGSVGElement
const texts = (selector: string) =>
    [...document.querySelectorAll(selector)].map((node) => node.textContent)
// The points of a path, in order.
function points(selector: string) {
    const d = chart().querySelector(selector)?.getAttribute('d') ?? ''
    return [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((match) => [
        Number(match[1]),
        Number(match[2]),
    ])
}

// Laid out 600 wide: a DOM with no layout measures every box as empty.
function pointAt(clientX: number) {
    chart().getBoundingClientRect = () => new DOMRect(0, 0, 600, 240)
    chart().dispatchEvent(new PointerEvent('pointermove', { clientX }))
    flushSync()
}

// 52.52 — A STACKED AREA CLOSES ONTO THE AREA UNDER IT, and through August, where Qualified has no
// value, at the height of what is under it. THE REVERT: close every area down to the plot's floor —
// Qualified's floor is 216 throughout where Proposals' top is due.
test('each stage stacks on the one before it, through a month it has no value', async () => {
    using _trend = await mount(PipelineTrend({}))
    const proposals = points("[data-part=area][data-series='0']")
    const qualified = points("[data-part=area][data-series='1']")
    const proposalsTop = proposals.slice(0, 6)
    const qualifiedFloor = qualified.slice(6).reverse()
    expect(qualifiedFloor).toEqual(proposalsTop)
    expect(qualified[2]).toEqual(proposalsTop[2] as number[])
    expect(proposals.slice(6).every(([, y]) => y === 216)).toBe(true)
})

// 52.55, 52.62 — THE TARGET IS IN NO STACK, drawn at its own values on an axis the bounds fix at
// $0-$150K. THE REVERT: drop `stack={false}` — the target stands on the leads, its first point
// above the plot.
test('the target is drawn at its own values, on an axis fixed at $150K', async () => {
    using _trend = await mount(PipelineTrend({}))
    expect(texts('[data-axis=y]')).toEqual(['$0', '$50K', '$100K', '$150K'])
    // $90K of $150K, up from the floor at 216 to the top at 16, right of the five characters of
    // `$150K` at 7 apiece and the 8 between them and the plot (52.69).
    expect(points('[data-part=line]')[0]).toEqual([43, 96])
})

// 52.24, 52.53 — A STAGE UNCHECKED IS NO LONGER DRAWN, and checked again it joins in the order it was
// mounted: last, after the target. THE REVERT: drop the disposer `joinChart`'s watch returns —
// unchecking leaves three areas.
test('leads leave the chart when unchecked, and come back last', async () => {
    using _trend = await mount(PipelineTrend({}))
    expect(chart().querySelectorAll('[data-part=area]')).toHaveLength(3)
    const leads = document.querySelector('input') as HTMLInputElement
    leads.click()
    flushSync()
    expect(chart().querySelectorAll('[data-part=area]')).toHaveLength(2)
    leads.click()
    flushSync()
    expect(chart().querySelectorAll('[data-part=area]')).toHaveLength(3)
    pointAt(0)
    expect(texts('[data-part=readout-value]')).toEqual([
        'Proposals: $12K',
        'Qualified: $22K',
        'Target: $90K',
        'Leads: $40K',
    ])
})
