import { expect, test } from 'bun:test'
import { mount } from '@abide/harness/abide'
import DealNote from '../lib/DealNote.abide'
import { LOADS } from '../server/LOADS.ts'
import { NOTES } from '../server/NOTES.ts'

test('a burst of typing is saved once, after it stops', async () => {
    using _note = await mount(DealNote({}))
    const input = document.querySelector('input')
    if (!input) throw new Error('no note field')
    const before = LOADS.saves ?? 0
    for (const typed of ['Sent', 'Sent the', 'Sent the quote']) {
        input.value = typed
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await Bun.sleep(50)
    }
    await Bun.sleep(900)
    // Three edits, three timers started, two cleared: one save.
    expect((LOADS.saves ?? 0) - before).toBe(1)
    expect(NOTES.d4).toBe('Sent the quote')
})
