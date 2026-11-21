import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import JumpTo from './JumpTo.abide'

const dialog = () => document.querySelector('dialog') as HTMLDialogElement
const input = () => dialog().querySelector('input') as HTMLInputElement
const options = () =>
    [...dialog().querySelectorAll('[role=option] [data-part=label]')].map(
        (option) => option.textContent,
    )

function press(key: string, init: KeyboardEventInit = {}) {
    ;(document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ...init,
        }),
    )
    flushSync()
}

function type(text: string) {
    input().value = text
    input().dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

// 51.72 — THE BINDING OPENS IT AND SHUTS IT, from the page and from its own input. THE REVERT: drop
// the `hotkeys` listener from `commandPalette` — Ctrl+K opens nothing.
test('Ctrl+K opens the palette with its input focused, and shuts it again', async () => {
    using _jump = await mount(JumpTo({}))
    expect(dialog().open).toBe(false)
    press('k', { ctrlKey: true })
    await Promise.resolve()
    expect(dialog().open).toBe(true)
    expect(document.activeElement).toBe(input())
    expect(options()).toEqual([
        'Contacts',
        'Companies',
        'Deals',
        'Pipeline',
        'Add a deal',
    ])
    press('k', { ctrlKey: true })
    expect(dialog().open).toBe(false)
})

// 51.73 — EVERY WORD TYPED IS IN THE LABEL OR A KEYWORD. THE REVERT: match the label alone —
// "forecast" lists nothing.
test('typing lists the commands whose label or keywords hold every word', async () => {
    using _jump = await mount(JumpTo({}))
    press('k', { ctrlKey: true })
    type('forecast')
    expect(options()).toEqual(['Pipeline'])
    type('new deal')
    expect(options()).toEqual(['Add a deal'])
    type('zebra')
    expect(options()).toEqual([])
    expect(dialog().querySelector('[role=status]')?.textContent?.trim()).toBe(
        'Nothing matches.',
    )
})

// 51.74, 51.75 — THE ARROWS MOVE THE ACTIVE COMMAND AND ENTER RUNS IT, the palette shut first. THE
// REVERT: run without shutting — the dialog stays open over the page it went to.
test('an arrow and Enter run the command, and the palette shuts', async () => {
    const went: string[] = []
    using _jump = await mount(JumpTo({ go: (address) => went.push(address) }))
    press('k', { ctrlKey: true })
    await Promise.resolve()
    expect(input().getAttribute('aria-activedescendant')).toBe(
        'command-palette-option-Contacts',
    )
    press('ArrowDown')
    expect(input().getAttribute('aria-activedescendant')).toBe(
        'command-palette-option-Companies',
    )
    press('Enter')
    expect(dialog().open).toBe(false)
    expect(went).toEqual(['/companies'])
    // Opened again, it lists every command afresh.
    press('k', { ctrlKey: true })
    expect(input().value).toBe('')
})

// 51.76 — ESCAPE IS THE DIALOG'S: the input lets it through, and the dialog cancels on it.
test('Escape is left to the dialog', async () => {
    using _jump = await mount(JumpTo({}))
    press('k', { ctrlKey: true })
    await Promise.resolve()
    const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
    })
    input().dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(false)
})
