import { expect, test } from 'bun:test'
import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'
import ContactFields from '../lib/ContactFields.abide'

test('typing writes the value, and the value fills the field', async () => {
    using _fields = await mount(ContactFields({}))
    const email = document.querySelector('input') as HTMLInputElement
    expect(email.value).toBe('ada@example.com')
    email.value = 'ada@lovelace.org'
    email.dispatchEvent(new Event('input'))
    flushSync()
    expect(document.querySelector('strong')?.textContent).toBe(
        'ada@lovelace.org',
    )
})
