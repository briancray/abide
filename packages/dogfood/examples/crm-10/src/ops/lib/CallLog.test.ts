import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import CallLog from './CallLog.abide'
import { calls } from './calls.ts'

test('a call logged with the network is saved, and nothing waits', async () => {
    using _log = await mount(CallLog({}))
    const input = document.querySelector('input') as HTMLInputElement
    input.value = 'Sent the quote'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('button')?.click()
    await Bun.sleep(10)
    flushSync()
    expect(calls().map((call) => call.note)).toContain('Sent the quote')
    const tiles = [...document.querySelectorAll('.tiles strong')]
    expect(tiles.map((tile) => tile.textContent)).toEqual(['0', 'yes'])
})

test('a call sent twice under one id is logged once', async () => {
    const { default: logCall } = await import('../logCall.handler.ts')
    const call = { id: 'again', note: 'Asked twice' }
    await logCall(call)
    await logCall(call)
    expect(calls().filter((each) => each.id === 'again').length).toBe(1)
})
