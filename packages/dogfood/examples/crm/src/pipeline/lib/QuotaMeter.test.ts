import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import QuotaMeter from './QuotaMeter.abide'

const track = () => document.querySelector('[role=meter]') as HTMLElement

test('the quota fills as far as the deals won reach', async () => {
    using _quota = await mount(QuotaMeter({}))
    expect(track().getAttribute('aria-valuenow')).toBe('410000')
    expect(track().getAttribute('aria-valuemax')).toBe('500000')
    expect(track().firstElementChild?.getAttribute('style')).toBe(
        'inline-size:82%',
    )
    expect(track().getAttribute('data-level')).toBe('middle')
    ;(document.querySelector('button') as HTMLButtonElement).click()
    flushSync()
    expect(track().firstElementChild?.getAttribute('style')).toBe(
        'inline-size:40%',
    )
    expect(track().getAttribute('data-level')).toBe('low')
})
