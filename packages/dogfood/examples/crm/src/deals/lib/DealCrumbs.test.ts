import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealCrumbs from './DealCrumbs.abide'

test('a long trail folds its middle into a menu', async () => {
    using _crumbs = await mount(DealCrumbs({}))
    const shown = [...document.querySelectorAll('nav > *')].map(
        (each) => each.textContent,
    )
    expect(shown).toEqual(['Home', '…', 'Analytical Engines', 'Engine renewal'])
    expect(document.querySelector('[aria-current=page]')?.textContent).toBe(
        'Engine renewal',
    )
    ;(
        document.querySelector('[aria-haspopup=menu]') as HTMLButtonElement
    ).click()
    flushSync()
    const folded = document.querySelector('[role=menu]') as HTMLElement
    expect(folded.matches(':popover-open')).toBe(true)
    expect(document.activeElement?.textContent).toBe('Companies')
    expect(document.activeElement?.getAttribute('href')).toBe('/companies')
})
