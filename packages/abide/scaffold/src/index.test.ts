import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import Index from './index.abide'

test('a click rewrites the count and builds nothing', async () => {
    using _page = await mount(Index({}))
    const work = measure(() => {
        document.querySelector('button')?.click()
        flushSync()
    })
    expect(document.querySelector('p')?.textContent).toBe('Clicked 1 times.')
    // One text node written, one effect woken, and no node made or moved.
    expect(work.dataWrites).toBe(1)
    expect(work.wakes).toBe(1)
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
})
