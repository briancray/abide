import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import WonAndClosed from './WonAndClosed.abide'

const chart = () => document.querySelector('svg') as SVGSVGElement
const texts = (selector: string) =>
    [...document.querySelectorAll(selector)].map((node) => node.textContent)
function press(key: string) {
    chart().dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
    flushSync()
}

// 52.118 — A SERIES SCALED TO SHARE AN AXIS READS IN ITS OWN UNITS: the axis is shares of each peak,
// and the readout and what a key move announces are the dollars and the deals behind them.
// THE REVERT: write every value by `yFormat` — 'Won: 100%' where '$42K' is due.
test('each series reads its own units, though both are drawn as shares of their peaks', async () => {
    using _chart = await mount(WonAndClosed({}))
    expect(texts('[data-axis=y]').at(-1)).toBe('100%')
    press('End')
    expect(texts('[data-chart=readout-value]')).toEqual([
        'Won: $42K',
        'Closed: 9 deals',
    ])
    press('ArrowLeft')
    expect(document.querySelector('[data-announce=polite]')?.textContent).toBe(
        'Oct 2026, Won: $27K, Closed: 7 deals',
    )
})
