import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { measure, mount } from '@abide/harness/abide'
import DealStage from '../lib/DealStage.abide'

test('advancing a deal rewrites its stage and builds nothing', async () => {
    using _card = await mount(DealStage({}))
    const work = measure(() => {
        document.querySelector('button')?.click()
        flushSync()
    })
    expect(document.querySelector('strong')?.textContent).toBe('qualified')
    // One text node written, one effect woken, and no node made or moved.
    expect(work.dataWrites).toBe(1)
    expect(work.wakes).toBe(1)
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
})
