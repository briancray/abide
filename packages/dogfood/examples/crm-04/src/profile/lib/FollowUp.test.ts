import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import FollowUp from './FollowUp.abide'

const dateField = () => document.querySelector('input[type="date"]')

test('the date field is in the page only while the box is ticked', async () => {
    using _followUp = await mount(FollowUp({}))
    const box = document.querySelector('input') as HTMLInputElement
    expect(dateField()).toBeNull()
    box.checked = true
    box.dispatchEvent(new Event('change'))
    flushSync()
    expect(dateField()).not.toBeNull()
    box.checked = false
    box.dispatchEvent(new Event('change'))
    flushSync()
    expect(dateField()).toBeNull()
})
