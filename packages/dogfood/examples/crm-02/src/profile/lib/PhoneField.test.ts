import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import PhoneField from './PhoneField.abide'

test('the record keeps the digits, and the field shows them back', async () => {
    using _phone = await mount(PhoneField({}))
    const field = document.querySelector('input') as HTMLInputElement
    field.value = '(415) 555-0132'
    field.dispatchEvent(new Event('input'))
    flushSync()
    expect(field.value).toBe('4155550132')
})
