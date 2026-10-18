import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import RecentActivity from './RecentActivity.abide'

test('logging past three adds one entry and drops the oldest', async () => {
    using _recent = await mount(RecentActivity({}))
    const rows = () =>
        [...document.querySelectorAll('li')].map((row) => row.textContent)
    const [, ...kept] = rows()
    document.querySelector('button')?.click()
    flushSync()
    const after = rows()
    expect(after).toHaveLength(3)
    expect(after.slice(0, 2)).toEqual(kept)
    expect(after[2]).toContain('Meeting')
})
