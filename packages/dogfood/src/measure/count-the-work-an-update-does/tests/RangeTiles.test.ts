import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import { measure } from '@abide/harness/measure'
import RangeTiles from '../lib/RangeTiles.abide'

test('a range switch rewrites three numbers, builds none', async () => {
    using _tiles = await mount(RangeTiles({}))
    const work = measure(() => {
        document.querySelectorAll('button')[1]?.click()
        flushSync()
    })
    // Three tiles' text, and both buttons' aria-pressed.
    expect(work.dataWrites).toBe(3)
    expect(work.attributesSet).toBe(2)
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
})
