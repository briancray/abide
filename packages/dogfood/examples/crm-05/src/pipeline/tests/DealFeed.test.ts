import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import DealFeed from '../lib/DealFeed.abide'

test('an update rewrites one amount and builds nothing', async () => {
    using _feed = await mount(DealFeed({}))
    await Bun.sleep(600)
    const work = measure(() => {
        document.querySelector('button')?.click()
        flushSync()
    })
    const amounts = [...document.querySelectorAll('strong')]
    expect(amounts.map((each) => each.textContent)).toContain('$27,500')
    // One text node rewritten: the other rows are not touched.
    expect(work.dataWrites).toBe(1)
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
})
