import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageFilter from './StageFilter.abide'

const opener = () => document.querySelector('button') as HTMLButtonElement
const panel = () => document.querySelector('[popover]') as HTMLElement
const shown = () => panel().matches(':popover-open')

const press = (target: Element) =>
    target.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
    )

// 50.48, 50.27, 50.59 — THE TRIGGER OPENS THE PANEL IN THE TOP LAYER, under the button and as the
// side it took says, and a pick that writes `open` back shuts it. THE REVERT: drop `anchored` from
// the popover part's binding — `open` turns true and the panel never shows.
test('the stage button opens its panel as a popover under it, and a pick shuts it', async () => {
    using _filter = await mount(StageFilter({}))
    expect(panel().getAttribute('popover')).toBe('manual')
    expect(shown()).toBe(false)
    opener().click()
    flushSync()
    expect(shown()).toBe(true)
    expect(opener().getAttribute('aria-expanded')).toBe('true')
    expect(panel().getAttribute('data-side')).toBe('bottom')
    expect(panel().style.getPropertyValue('--anchor-width')).toMatch(/px$/)
    const lead = [...panel().querySelectorAll('button')].find(
        (each) => each.textContent === 'Lead',
    ) as HTMLButtonElement
    lead.click()
    flushSync()
    expect(shown()).toBe(false)
    expect(opener().textContent).toBe('Stage: Lead')
})

// 50.60, 53.15 — Escape and a press outside are the panel's, as a layer `dismissible` stacks, and a
// press on its own button is the button's: it shuts the panel once, not shuts and reopens it.
// THE REVERT: drop `inside: [at]` from the popover's dismissal — the press on the button shuts the
// panel and the click opens it again.
test('Escape, a press outside and a second press on the button each shut the stage panel', async () => {
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
    expect(shown()).toBe(false)

    opener().click()
    flushSync()
    press(document.body)
    flushSync()
    expect(shown()).toBe(false)

    opener().click()
    flushSync()
    press(opener())
    opener().click()
    flushSync()
    expect(shown()).toBe(false)
})
