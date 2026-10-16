import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import ClosedTiles from '../lib/ClosedTiles.abide'

test('a range switch rewrites two numbers and builds nothing', async () => {
    using _tiles = await mount(ClosedTiles({}))
    const work = measure(() => {
        document.querySelectorAll('button')[1]?.click()
        flushSync()
    })
    expect(work.dataWrites).toBe(2)
    expect(work.nodesCreated).toBe(0)
})
