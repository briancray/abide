import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import DealHistory from './DealHistory.abide'

const button = () => document.querySelector('button') as HTMLButtonElement
const list = () => document.querySelector('ol') as HTMLElement

test('the history is hidden until its button shows it, and found by find in page', async () => {
    using _history = await mount(DealHistory({}))
    expect(list().getAttribute('hidden')).toBe('until-found')
    expect(button().getAttribute('aria-controls')).toBe(list().id)
    button().click()
    flushSync()
    expect(list().hasAttribute('hidden')).toBe(false)
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(button().textContent?.trim()).toBe('Hide stage history')
    button().click()
    flushSync()
    // A find in page reaching the shut list opens it.
    list().dispatchEvent(new Event('beforematch'))
    flushSync()
    expect(list().hasAttribute('hidden')).toBe(false)
})
