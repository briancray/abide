import { afterEach, expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { createApp } from '@abide/abide/server'
import { measure, mount } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import SaveShortcut from './SaveShortcut.abide'

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15'

afterEach(() => {
    Reflect.deleteProperty(navigator, 'userAgent')
})

function press(init: KeyboardEventInit): boolean {
    const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        ...init,
    })
    document.querySelector('textarea')?.dispatchEvent(event)
    flushSync()
    return event.defaultPrevented
}

function type(words: string) {
    const field = document.querySelector('textarea') as HTMLTextAreaElement
    field.value = words
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

// The server renders the label for the browser that asked, so the page hydrates what it painted.
test('on a Mac, ⌘Enter saves from inside the note, and Ctrl+Enter does not', async () => {
    Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => MAC,
    })
    await using app = await createApp()
    await app.run(
        async () => {
            using _note = await mount(SaveShortcut({}))
            expect(document.querySelector('kbd')?.textContent).toBe('⌘Enter')
            type('Wants a three-year term.')
            // Not the binding: nothing taken, nothing built.
            let taken = true
            const work = measure(() => {
                taken = press({ ctrlKey: true })
            })
            expect(taken).toBe(false)
            atMost(work, { nodesCreated: 0 })
            expect(press({ metaKey: true })).toBe(true)
            expect(document.querySelector('strong')?.textContent).toBe(
                'Wants a three-year term.',
            )
            expect(document.querySelector('textarea')?.value).toBe('')
        },
        {
            request: new Request('http://crm.invalid/deals', {
                headers: { 'user-agent': MAC },
            }),
        },
    )
})

test('anywhere else the label and the key are Ctrl+Enter', async () => {
    using _note = await mount(SaveShortcut({}))
    expect(document.querySelector('kbd')?.textContent).toBe('Ctrl+Enter')
    type('Send the renewal.')
    expect(press({ metaKey: true })).toBe(false)
    expect(press({ ctrlKey: true })).toBe(true)
    expect(document.querySelector('strong')?.textContent).toBe(
        'Send the renewal.',
    )
})
