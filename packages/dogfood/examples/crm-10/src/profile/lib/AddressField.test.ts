import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import AddressField from './AddressField.abide'

test('a write to the city reaches the record it sits in', async () => {
    using _address = await mount(AddressField({}))
    const city = document.querySelector('input') as HTMLInputElement
    city.value = 'Oslo'
    city.dispatchEvent(new Event('input'))
    flushSync()
    expect(document.querySelector('strong')?.textContent).toBe(
        'Ada Lovelace, Oslo',
    )
})
