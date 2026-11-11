import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContactPanel from './ContactPanel.abide'

function press(label: string): void {
    for (const button of document.querySelectorAll('button'))
        if (button.textContent === label) button.click()
    flushSync()
}

test('each contact gets a new panel element', async () => {
    using _panel = await mount(ContactPanel({}))
    const first = document.querySelector('p')
    expect(first?.textContent?.trim()).toBe('Grace Hopper')
    press('Ada Lovelace')
    const next = document.querySelector('p')
    expect(next?.textContent?.trim()).toBe('Ada Lovelace')
    // A new element, not the old one rewritten.
    expect(next).not.toBe(first)
    expect(first?.isConnected).toBe(false)
})
