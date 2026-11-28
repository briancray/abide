import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { measure, mount, settled } from '@abide/harness/abide'
import { atMost } from '@abide/harness/gate'

import ContactPicker from './ContactPicker.abide'

const input = () => document.querySelector('input') as HTMLInputElement
const names = () =>
    [...document.querySelectorAll('[role=option]')].map(
        (option) => option.textContent,
    )

function type(text: string) {
    input().value = text
    input().dispatchEvent(new Event('input'))
    flushSync()
}

test('typing narrows the contacts, ignoring case', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    type('ER')
    expect(names()).toEqual(['Grace Hopper', 'Katherine Johnson'])
    type('')
    expect(names()).toHaveLength(3)
    type('zz')
    expect(
        document.querySelector('[data-combobox=empty]')?.textContent?.trim(),
    ).toBe('No contact matches')
})

// 51.106 — WHAT WAS TYPED IS MARKED in each contact listed, where the narrowing found it.
// THE REVERT: render the label whole in `ContactPicker` — no contact carries a mark.
test('what was typed is marked in each contact it lists', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    type('ER')
    expect(names()).toEqual(['Grace Hopper', 'Katherine Johnson'])
    expect(
        [
            ...document.querySelectorAll(
                '[role=option] mark[data-combobox=match]',
            ),
        ].map((mark) => mark.textContent),
    ).toEqual(['er', 'er'])
})

test('narrowing keeps the rows still listed, and builds none', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    type('o')
    const kept = document.querySelectorAll('[role=option]')[1]
    const work = measure(() => type('ho'))
    expect(document.querySelectorAll('[role=option]')[0]).toBe(kept)
    atMost(work, { nodesCreated: 0 })
})

test('Enter picks the active contact, and the input shows it — 51.22', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    type('ka')
    input().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    )
    flushSync()
    expect([
        input().value,
        document.querySelector('strong')?.textContent,
    ]).toEqual(['Katherine Johnson', 'Langley Research'])
})

// 51.27, 51.28 — THE FIRST ESCAPE SHUTS THE LIST AND DROPS WHAT WAS TYPED, so the field shows the
// contact picked again; the second clears the pick; the third is the page's. THE REVERTS: leave the
// typed text standing on the first, and the field reads `kat` beside Katherine Johnson's company;
// hand every Escape to the list, and the third is prevented, so a `<dialog>` holding the picker
// never cancels.
test('Escape shuts, then clears, then is left to the page', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    type('ka')
    const escape = () => {
        const event = new KeyboardEvent('keydown', {
            key: 'Escape',
            cancelable: true,
            bubbles: true,
        })
        input().dispatchEvent(event)
        flushSync()
        return event.defaultPrevented
    }
    input().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    )
    flushSync()
    type('kat')
    expect(escape()).toBe(true)
    expect(document.querySelector('[role=listbox]')).toBeNull()
    expect(input().value).toBe('Katherine Johnson')
    expect(escape()).toBe(true)
    expect([
        input().value,
        document.querySelector('strong')?.textContent,
    ]).toEqual(['', '—'])
    expect(escape()).toBe(false)
})

// 51.29 — LEAVING THE FIELD SHUTS THE LIST AND DROPS WHAT WAS TYPED: what it shows is what it holds.
// THE REVERT: shut the list on blur and keep the text — the field reads `gr` with no contact picked.
test('leaving the field shuts the list, and it shows the pick again', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    type('gr')
    input().dispatchEvent(new FocusEvent('blur'))
    flushSync()
    expect([document.querySelector('[role=listbox]'), input().value]).toEqual([
        null,
        '',
    ])
})

function key(name: string, alt = false) {
    input().dispatchEvent(
        new KeyboardEvent('keydown', {
            key: name,
            altKey: alt,
            cancelable: true,
        }),
    )
    flushSync()
}
const shut = () => document.querySelector('[role=listbox]') === null
const active = () =>
    document.querySelector('[role=option][data-active]')?.textContent

// 51.92 — A PRESS ASKS FOR THE LIST, FOCUS DOES NOT: Tab reaching the field opens nothing, a click
// lists every contact, and a second click shuts it, as a press on a menu's trigger does. THE REVERT:
// drop `onclick` from the input part — a click lists nothing; open on `focus` too — Tab opens it.
test('a press lists every contact and a second shuts it, and focus opens nothing', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    input().dispatchEvent(new FocusEvent('focus'))
    input().dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    flushSync()
    expect(shut()).toBe(true)
    input().click()
    flushSync()
    await settled()
    expect(names()).toEqual([
        'Ada Lovelace',
        'Grace Hopper',
        'Katherine Johnson',
    ])
    input().click()
    flushSync()
    expect(shut()).toBe(true)
})

// 51.93 — ALT WITH AN ARROW OPENS OR SHUTS, AND NEVER STEPS: Alt+ArrowDown opens the list, again on
// the open list it leaves the active contact where it stands, and Alt+ArrowUp shuts it. THE REVERT:
// hand Alt+arrows to the list as plain arrows — the second Alt+ArrowDown steps to Grace, and
// Alt+ArrowUp steps rather than shutting.
test('Alt+ArrowDown opens the list without stepping, and Alt+ArrowUp shuts it', async () => {
    using _picker = await mount(ContactPicker({}))
    await settled()
    key('ArrowDown', true)
    await settled()
    expect(shut()).toBe(false)
    expect(active()).toBe('Ada Lovelace')
    key('ArrowDown', true)
    expect(active()).toBe('Ada Lovelace')
    key('ArrowUp', true)
    expect(shut()).toBe(true)
    key('ArrowUp', true)
    expect(shut()).toBe(true)
})
