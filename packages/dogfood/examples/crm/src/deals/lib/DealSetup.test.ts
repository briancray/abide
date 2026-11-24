import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealSetup from './DealSetup.abide'

const next = () =>
    document.querySelector('[data-wizard=next]') as HTMLButtonElement
const current = () => document.querySelector('[aria-current=step]')?.textContent

test('the setup goes on once a step is done, and back to any step done', async () => {
    using _setup = await mount(DealSetup({}))
    expect([current(), next().disabled]).toEqual(['name', true])
    const name = document.querySelector('input') as HTMLInputElement
    name.value = 'Engine renewal'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(next().disabled).toBe(false)
    next().click()
    flushSync()
    next().click()
    flushSync()
    expect(current()).toBe('review')
    expect(document.querySelector('.status')?.textContent).toBe(
        'Engine renewal — lead',
    )
    expect(document.querySelectorAll('[data-done]')).toHaveLength(2)
    ;(document.querySelector('[data-done]') as HTMLElement).click()
    flushSync()
    expect(current()).toBe('name')
})
