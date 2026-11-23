import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import PipelineTrend from './PipelineTrend.abide'

const chart = () => document.querySelector('svg') as SVGSVGElement
const texts = (selector: string) =>
    [...document.querySelectorAll(selector)].map((node) => node.textContent)
const d = (selector: string) =>
    chart().querySelector(selector)?.getAttribute('d') ?? ''
// The points a path passes through, in order: a curve's control points are not among them.
function points(selector: string) {
    return [...d(selector).matchAll(/(-?[\d.]+),(-?[\d.]+)(?=[MLCZ]|$)/g)].map(
        (match) => [Number(match[1]), Number(match[2])],
    )
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
    const proposals = points("[data-chart=area][data-series='0']")
    const qualified = points("[data-chart=area][data-series='1']")
    const proposalsTop = proposals.slice(0, 6)
    const qualifiedFloor = qualified.slice(6).reverse()
    expect(qualifiedFloor).toEqual(proposalsTop)
    expect(qualified[2]).toEqual(proposalsTop[2] as number[])
    expect(proposals.slice(6).every(([, y]) => y === 216)).toBe(true)
})

// 52.98 — THE STAGES CURVE, each through its own months and each floor along the curve of the stage
// under it. THE REVERT: drop `curve` from what `Chart` hands `chart.path` — every edge is straight,
// and Proposals' top has no cubic in it.
test('each stage curves through its months, on the curve of the one under it', async () => {
    using _trend = await mount(PipelineTrend({}))
    const proposals = d("[data-chart=area][data-series='0']")
    const qualified = d("[data-chart=area][data-series='1']")
    // Proposals' top, from its first month to its last: five cubics.
    const top = proposals.slice(0, proposals.indexOf('L'))
    expect(top.match(/C/g)).toHaveLength(5)
    // Walked back, each cubic's two control points swap and it ends where it began.
    const [start = '', ...cubics] = top.slice(1).split('C')
    const ends = [start, ...cubics.map((cubic) => cubic.split(' ')[2])]
    let back = ''
    for (let at = cubics.length - 1; at >= 0; at -= 1) {
        const [first, second] = (cubics[at] as string).split(' ')
        back += `C${second} ${first} ${ends[at]}`
    }
    expect(qualified.endsWith(`${back}Z`)).toBe(true)
})

// 52.55, 52.62 — THE TARGET IS IN NO STACK, drawn at its own values on an axis the bounds fix at
// $0-$150K. THE REVERT: drop `stack={false}` — the target stands on the leads, its first point
// above the plot.
test('the target is drawn at its own values, on an axis fixed at $150K', async () => {
    using _trend = await mount(PipelineTrend({}))
    expect(texts('[data-axis=y]')).toEqual(['$0', '$50K', '$100K', '$150K'])
    // $90K of $150K, up from the floor at 216 to the top at 16, right of the five characters of
    // `$150K` at 7 apiece and the 8 between them and the plot (52.69).
    expect(points('[data-chart=line]')[0]).toEqual([43, 96])
})

// 52.24, 52.53 — A STAGE UNCHECKED IS NO LONGER DRAWN, and checked again it joins in the order it was
// mounted: last, after the target. THE REVERT: drop the disposer `joinChart`'s watch returns —
// unchecking leaves three areas.
test('leads leave the chart when unchecked, and come back last', async () => {
    using _trend = await mount(PipelineTrend({}))
    expect(chart().querySelectorAll('[data-chart=area]')).toHaveLength(3)
    const leads = document.querySelector('input') as HTMLInputElement
    leads.click()
    flushSync()
    expect(chart().querySelectorAll('[data-chart=area]')).toHaveLength(2)
    leads.click()
    flushSync()
    expect(chart().querySelectorAll('[data-chart=area]')).toHaveLength(3)
    pointAt(0)
    expect(texts('[data-chart=readout-value]')).toEqual([
        'Proposals: $12K',
        'Qualified: $22K',
        'Target: $90K',
        'Leads: $40K',
    ])
})
