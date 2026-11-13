import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import olderActivity from '../olderActivity.handler.ts'
import ActivityHistory from './ActivityHistory.abide'

const listed = () => document.querySelectorAll('li').length

test('the list shows each entry as it is read', async () => {
    using _history = await mount(ActivityHistory({}))
    const reading = () => document.body.textContent?.includes('reading')
    while (listed() === 0) await Bun.sleep(20)
    // One entry in, and the archive still being read.
    expect(listed()).toBeLessThan(3)
    expect(reading()).toBe(true)
    // The rest arrive on their own; the test times out where they never do.
    while (listed() < 3) await Bun.sleep(20)
})

test('the first entry is in hand while the rest are still read', async () => {
    // Read afresh rather than the run the test above left settled.
    olderActivity.invalidate()
    const entries = olderActivity()
    const stillReading: boolean[] = []
    for await (const _entry of entries) stillReading.push(entries.busy())
    expect(stillReading).toHaveLength(3)
    expect(stillReading[0]).toBe(true)
})
