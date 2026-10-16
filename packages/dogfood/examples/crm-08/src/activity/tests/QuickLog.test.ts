import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import QuickLog from '../lib/QuickLog.abide'

test('a reader the logger never names follows what it logs', async () => {
    using _log = await mount(QuickLog({}))
    const last = () => document.querySelector('strong')?.textContent
    expect(last()).not.toBe('Call with Grace Hopper')
    document.querySelector('button')?.click()
    flushSync()
    expect(last()).toBe('Call with Grace Hopper')
})
