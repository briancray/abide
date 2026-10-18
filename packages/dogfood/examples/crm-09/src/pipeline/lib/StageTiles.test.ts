import { expect, test } from 'bun:test'
import { mount } from '@abide/harness/abide'
import getStage from '../getStage.ts'
import StageTiles from './StageTiles.abide'
import { LOADS } from './LOADS.server.ts'

function pick(index: number, stage: string): void {
    const select = document.querySelectorAll('select')[index]
    if (!select) throw new Error('no stage picker')
    select.value = stage
    select.dispatchEvent(new Event('change', { bubbles: true }))
}

test('two readers of one stage are one load', async () => {
    // Nothing held from an earlier test, so the first read loads.
    getStage.invalidate()
    const before = LOADS.won ?? 0
    using _tiles = await mount(StageTiles({}))
    pick(0, 'won')
    pick(1, 'won')
    await Bun.sleep(600)
    // Both panels on `won`: one load between them.
    expect((LOADS.won ?? 0) - before).toBe(1)
})
