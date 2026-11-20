import { afterEach, expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import CopyEmail from './CopyEmail.abide'

const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard)
})

test('a click copies the email and marks the button copied', async () => {
    const copied: string[] = []
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
            write: async (items: ClipboardItem[]) => {
                for (const item of items)
                    copied.push(await (await item.getType('text/plain')).text())
            },
        },
    })
    using _email = await mount(CopyEmail({}))
    const button = document.querySelector('button') as HTMLButtonElement
    expect(button.hasAttribute('data-copied')).toBe(false)
    button.click()
    // The copy settles in microtasks; a macrotask turn is past all of them.
    await Bun.sleep(0)
    expect(copied).toEqual(['grace@hopper.example'])
    expect(button.hasAttribute('data-copied')).toBe(true)
})
