import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageFilter from './StageFilter.abide'

const opener = () => document.querySelector('button') as HTMLButtonElement
const panel = () => document.querySelector('[popover]') as HTMLElement | null

// 50.49, 50.27 — THE PANEL OPENS IN THE TOP LAYER FOR AS LONG AS IT IS BOUND, under the button and
// as the side it took says. THE REVERT: drop `popover` from the panel's binding — it renders in
// the page's flow with no `popover` and no `data-side`.
test('the stage panel opens as a popover under its button, and shuts with its {#if}', async () => {
    using _filter = await mount(StageFilter({}))
    expect(panel()).toBeNull()
    opener().click()
    flushSync()
    expect(panel()?.getAttribute('popover')).toBe('manual')
    expect(panel()?.matches(':popover-open')).toBe(true)
    expect(panel()?.getAttribute('data-side')).toBe('bottom')
    expect(panel()?.style.getPropertyValue('--anchor-width')).toMatch(/px$/)
    const lead = [...document.querySelectorAll('[popover] button')].find(
        (each) => each.textContent === 'Lead',
    ) as HTMLButtonElement
    lead.click()
    flushSync()
    expect(panel()).toBeNull()
    expect(opener().textContent).toBe('Stage: Lead')
})

// 53.15 — Escape is the panel's, as a layer `dismissible` stacks, and the next one the page's.
test('Escape shuts the stage panel', async () => {
    using _filter = await mount(StageFilter({}))
    opener().click()
    flushSync()
    const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
    })
    document.body.dispatchEvent(escape)
    flushSync()
    expect(escape.defaultPrevented).toBe(true)
    expect(panel()).toBeNull()
})
