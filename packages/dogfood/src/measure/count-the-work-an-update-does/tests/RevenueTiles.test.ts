import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import { measure, publishedBy } from '@abide/harness/measure'
import RevenueTiles from '../lib/RevenueTiles.abide'

test('three tiles read one summary, worked out once per range', async () => {
    using _tiles = await mount(RevenueTiles({}))
    const work = measure(() => {
        document.querySelectorAll('button')[1]?.click()
        flushSync()
    })
    expect(publishedBy(work, 'dashboard', ['summaries'])?.summaries).toBe(1)
})
