import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ExportStages from './ExportStages.abide'

const trigger = () => document.querySelector('[role=combobox]') as HTMLElement
const shown = () => trigger().textContent?.trim()
const isOpen = () => document.querySelector('[role=listbox]') !== null
const picked = () =>
    [...document.querySelectorAll('[role=option][aria-selected=true]')].map(
        (option) => option.textContent,
    )

function press(key: string) {
    trigger().dispatchEvent(
        new KeyboardEvent('keydown', { key, cancelable: true }),
    )
    flushSync()
}

// 51.204 — A PICK ADDS A STAGE OR TAKES IT OUT, AND THE LIST STAYS OPEN. THE REVERT: shut the list
// on every pick in `select`, and the second Space finds it shut.
test('picking adds a stage, picking it again takes it out, and the list stays open', async () => {
    using _export = await mount(ExportStages({}))
    expect(shown()).toBe('Every stage')
    press('ArrowDown')
    press(' ')
    press('ArrowDown')
    press('ArrowDown')
    press('Enter')
    expect([isOpen(), shown(), picked()]).toEqual([
        true,
        'lead, proposal',
        ['lead', 'proposal'],
    ])
    expect(
        document
            .querySelector('[role=listbox]')
            ?.getAttribute('aria-multiselectable'),
    ).toBe('true')
    ;(document.querySelector('[role=option]') as HTMLElement).click()
    flushSync()
    expect([isOpen(), shown()]).toEqual([true, 'proposal'])
})

// 51.201 — EACH PICKED STAGE IS A FIELD of the form, in the order picked. THE REVERT: spread one
// `input` for the first stage, and the form submits `won` alone.
test('a form holding the select submits each picked stage under its name', async () => {
    using _export = await mount(ExportStages({}))
    press('w')
    press('Enter')
    press('ArrowUp')
    press('ArrowUp')
    press('Enter')
    expect(
        new FormData(document.querySelector('form') as HTMLFormElement).getAll(
            'stages',
        ),
    ).toEqual(['won', 'qualified'])
})
