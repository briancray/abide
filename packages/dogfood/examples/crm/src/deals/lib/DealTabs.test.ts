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
    expect(shown()).toEqual(['Engine renewal', 'Analytical Engines'])
    ;(tabs()[0] as HTMLElement).focus()
    press('ArrowRight')
    expect(document.activeElement?.textContent).toBe('Value')
    expect(shown()).toEqual(['$12,000'])
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
    // The Value tab's one field, and the marks on two tabs and the panel
    atMost(work, { nodesCreated: 6, attributesSet: 7 })
})
