import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount, settled } from '@abide/harness/abide'

import StageTabs from './StageTabs.abide'

const tab = (name: string) =>
    [...document.querySelectorAll<HTMLElement>('[role=tab]')].find(
        (each) => each.textContent === name,
    ) as HTMLElement
const panel = () => document.querySelector('[role=tabpanel]') as HTMLElement
const listed = () =>
    [...panel().querySelectorAll('strong')].map((name) => name.textContent)

function click(name: string) {
    tab(name).click()
    flushSync()
}

// 51.40 — ONE PANEL FOR EVERY TAB: the shared `panel` takes the selected tab's id and label. THE
// REVERT: spread the first tab's own `view.tab('lead').panel` instead, and the panel stays labelled
// by the first tab whichever is selected.
test('the tabs share one panel, labelled by whichever is selected', async () => {
    using _tabs = await mount(StageTabs({}))
    await settled()
    flushSync()
    const shown = panel()
    expect(shown.getAttribute('aria-labelledby')).toBe(tab('lead').id)
    click('proposal')
    expect(panel()).toBe(shown)
    expect(shown.getAttribute('aria-labelledby')).toBe(tab('proposal').id)
    expect(tab('proposal').getAttribute('aria-controls')).toBe(shown.id)
})

// THE REVERT: filter on a stage the tabs do not write, and the listing stays on the first tab's deals.
test('the listing is the panel, and its rows follow the tab — 51.35', async () => {
    using _tabs = await mount(StageTabs({}))
    await settled()
    flushSync()
    expect(listed()).toEqual([
        'Hopper & Co pilot',
        'Langley Research audit',
        'Hopper & Co training',
    ])
    click('proposal')
    expect(listed()).toEqual([
        'Analytical Engines renewal',
        'Hopper & Co expansion',
    ])
})
