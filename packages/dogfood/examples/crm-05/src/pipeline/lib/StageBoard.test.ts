import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import { LOADS } from './LOADS.server.ts'
import StageBoard from './StageBoard.abide'
import { STAGES } from './STAGES.ts'

function counted(): number[] {
    return STAGES.map((stage) => LOADS[stage] ?? 0)
}

test('winning a lead reloads lead and won, and no other stage', async () => {
    using _board = await mount(StageBoard({}))
    await Bun.sleep(600)
    const before = counted()

    document.querySelector('button')?.click()
    await Bun.sleep(600)
    const after = counted()
    expect(after.map((count, at) => count - (before[at] ?? 0))).toEqual([
        1, 0, 0, 1,
    ])
})
