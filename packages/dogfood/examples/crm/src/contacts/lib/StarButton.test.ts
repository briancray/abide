import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StarButton from './StarButton.abide'

test('the click writes starred and the button follows', async () => {
    using _button = await mount(StarButton({}))
    const button = document.querySelector('button')
    expect(button?.textContent).toBe('☆ Star')
    button?.click()
    flushSync()
    expect(button?.textContent).toBe('★ Starred')
})
