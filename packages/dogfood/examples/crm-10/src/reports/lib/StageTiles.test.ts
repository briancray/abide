import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import { measure, publishedBy } from '@abide/harness/measure'

import StageTiles from './StageTiles.abide'

test('three tiles read one summary, worked out once per switch', async () => {
    using _tiles = await mount(StageTiles({}))
    const work = measure(() => {
        document.querySelectorAll('button')[1]?.click()
        flushSync()
    })
    expect(publishedBy(work, 'reports', ['summaries'])?.summaries).toBe(1)
})
