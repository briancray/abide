import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContactPhoto from './ContactPhoto.abide'

const ICON = new URL('../../public/icon.png', import.meta.url)

test('a photo picked is shrunk before it is kept', async () => {
    using _photo = await mount(ContactPhoto({}))
    const photo = new File([await Bun.file(ICON).bytes()], 'ada.png', {
        type: 'image/png',
    })
    const field = document.querySelector('input') as HTMLInputElement
    Object.defineProperty(field, 'files', { value: [photo] })
    field.dispatchEvent(new Event('change', { bubbles: true }))
    for (
        let wait = 0;
        wait < 50 && document.querySelector('.status') === null;
        wait += 1
    ) {
        await Bun.sleep(20)
        flushSync()
    }
    const status = document.querySelector('.status')?.textContent ?? ''
    expect(status.startsWith('ada.jpg, ')).toBe(true)
    expect(photo.size).toBeGreaterThan(40_000)
})
