import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount, settled } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import DealTabs from './DealTabs.abide'

const tabs = () => [...document.querySelectorAll('[role=tab]')]
const shown = () =>
    [...document.querySelectorAll('[role=tabpanel] strong')].map(
        (field) => field.textContent,
    )

function press(key: string) {
    document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
    flushSync()
}

test('the arrow keys move between tabs, and the panel follows', async () => {
    using _tabs = await mount(DealTabs({}))
    await settled()
    expect(shown()).toEqual([
        'Analytical Engines renewal',
        'Analytical Engines',
    ])
    ;(tabs()[0] as HTMLElement).focus()
    press('ArrowRight')
    expect(document.activeElement?.textContent).toBe('Value')
    expect(shown()).toEqual(['$42,000'])
    press('End')
    expect(shown()).toEqual(['proposal'])
    press('ArrowRight')
    expect(document.activeElement?.textContent).toBe('Details')
    // Only the selected tab is in the page's tab order.
    expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual([
        '0',
        '-1',
        '-1',
    ])
})

test('switching tabs rebuilds the panel, and none of the tabs', async () => {
    using _tabs = await mount(DealTabs({}))
    await settled()
    const before = tabs()
    ;(before[0] as HTMLElement).focus()
    const work = measure(() => press('ArrowRight'))
    expect(tabs().every((tab, at) => tab === before[at])).toBe(true)
    expect(tabs().map((tab) => tab.hasAttribute('data-selected'))).toEqual([
        false,
        true,
        false,
    ])
    // The Value tab's one field, the four marks on each of two tabs (`aria-controls` among them, which
    // only the selected tab writes), and the panel's id and label, which follow the tab selected (51.40)
    atMost(work, { nodesCreated: 6, attributesSet: 10 })
})

// THE REVERT: hand the panel a fixed id, and the selected tab's `aria-controls` names nothing; have
// every tab name its own panel, and the two not selected name panels that are not there.
test('the selected tab controls the panel, and the panel is labelled by it', async () => {
    using _tabs = await mount(DealTabs({}))
    await settled()
    ;(tabs()[2] as HTMLElement).click()
    flushSync()
    const panel = document.querySelector('[role=tabpanel]') as HTMLElement
    expect(tabs().map((tab) => tab.getAttribute('aria-controls'))).toEqual([
        null,
        null,
        panel.id,
    ])
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[2]?.id)
})
