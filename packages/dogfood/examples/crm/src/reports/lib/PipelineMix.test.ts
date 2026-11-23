import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import PipelineMix from './PipelineMix.abide'

const slices = () => [
    ...document.querySelectorAll<SVGCircleElement>('[data-pie=slice]'),
]
// A slice's length along the ring and where it starts, both as shares of the ring (52.63).
function sweep(slice: SVGCircleElement) {
    const [length = 0, ring = 1] = slice.style.strokeDasharray
        .split(/[ ,]+/)
        .map(Number)
    return {
        share: length / ring,
        from: -Number(slice.style.strokeDashoffset) / ring,
    }
}

// 52.64, 52.65 — EACH STAGE IS ITS SHARE OF THE RING, clockwise in order, and a stage holding nothing
// is no slice. THE REVERT: count each slice from the top — every `from` reads 0.
test('each stage sweeps its share of the ring, one after the other', async () => {
    using _mix = await mount(PipelineMix({}))
    expect(slices().map((slice) => slice.dataset.series)).toEqual([
        '0',
        '1',
        '2',
        '4',
    ])
    const sweeps = slices().map(sweep)
    const shares = [66 / 150, 34 / 150, 30 / 150, 20 / 150]
    let from = 0
    for (let at = 0; at < 4; at += 1) {
        expect(sweeps[at]?.share).toBeCloseTo(shares[at] as number)
        expect(sweeps[at]?.from).toBeCloseTo(from)
        from += shares[at] as number
    }
})

// 52.66 — A DONUT'S HOLE IS `inner` OF THE RADIUS: 0.6 of 50 leaves a ring from 30 to 50, stroked 20
// wide along its middle. THE REVERT: ignore `inner` — the stroke is 50 wide, a pie.
test('the pie is a donut with a hole of 0.6 of its radius', async () => {
    using _mix = await mount(PipelineMix({}))
    const first = slices()[0] as SVGCircleElement
    expect(first.getAttribute('r')).toBe('40')
    expect(first.getAttribute('stroke-width')).toBe('20')
})

// 52.67 — A SLICE IS DESCRIBED BY ITS HINT: label, value and share. THE REVERT: write the hint with
// the value alone — 'Lead: $66K' where its share is due.
test('a slice reads its stage, its value and its share', async () => {
    using _mix = await mount(PipelineMix({}))
    expect(slices()[0]?.getAttribute('aria-description')).toBe(
        'Lead: $66K (44%)',
    )
})

// 52.38, 52.39 — A CLICK ON A SLICE PICKS ITS STAGE, save Verbal, which is marked. THE REVERT: drop
// the `disabled` check in `pick` — Verbal is picked.
test('a click on a slice opens its stage, and Verbal takes no pick', async () => {
    using _mix = await mount(PipelineMix({}))
    const [lead, , , verbal] = slices() as SVGCircleElement[]
    lead?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(document.querySelector('p')?.textContent).toBe('Open deals at Lead')
    verbal?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    flushSync()
    expect(document.querySelector('p')?.textContent).toBe('Open deals at Lead')
    expect(verbal?.hasAttribute('data-disabled')).toBe(true)
})
