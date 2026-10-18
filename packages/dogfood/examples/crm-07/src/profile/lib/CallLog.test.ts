import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import CallLog from './CallLog.abide'

const rows = () =>
    [...document.querySelectorAll('li')].map((row) =>
        row.textContent?.replace(/\s+/g, ' ').replace('Log a call', '').trim(),
    )

test('each row keeps its own count, and the module numbers them', async () => {
    using _log = await mount(CallLog({}))
    document.querySelector('button')?.click()
    flushSync()
    expect(rows()).toEqual([
        '#1 Ada Lovelace · 1 logged',
        '#2 Grace Hopper · 0 logged',
    ])
})
