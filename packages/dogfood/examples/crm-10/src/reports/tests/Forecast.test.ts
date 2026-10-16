import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import Forecast from '../lib/Forecast.abide'

test('advancing a deal moves the forecast by its weighted amount', async () => {
    using _forecast = await mount(Forecast({}))
    const total = () => document.querySelector('.tiles strong')?.textContent
    expect(total()).toBe('$6120')
    document.querySelectorAll('button')[1]?.click()
    flushSync()
    // Hopper & Co, qualified to proposal: 4,400 at 0.6 instead of 0.3.
    expect(total()).toBe('$7440')
})
