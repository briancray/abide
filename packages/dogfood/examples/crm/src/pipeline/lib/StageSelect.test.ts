import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import StageSelect from './StageSelect.abide'

const trigger = () => document.querySelector('[role=combobox]') as HTMLElement
const shown = () => trigger().textContent?.trim()
const options = () =>
    [...document.querySelectorAll('[role=option]')].map((option) => ({
        stage: option.textContent,
        active: option.hasAttribute('data-active'),
    }))
const isOpen = () => document.querySelector('[role=listbox]') !== null

function press(key: string): boolean {
    const event = new KeyboardEvent('keydown', {
        key,
        cancelable: true,
        bubbles: true,
    })
    trigger().dispatchEvent(event)
    flushSync()
    return event.defaultPrevented
}

test('ArrowDown opens the list on the first stage, and Enter picks the active one — 51.194, 51.195, 51.197, 51.203', async () => {
    using _select = await mount(StageSelect({}))
    expect([isOpen(), shown()]).toEqual([false, 'Pick a stage'])
    press('ArrowDown')
    expect(options()).toEqual([
        { stage: 'lead', active: true },
        { stage: 'qualified', active: false },
        { stage: 'proposal', active: false },
        { stage: 'won', active: false },
    ])
    press('ArrowDown')
    expect(trigger().getAttribute('aria-activedescendant')).toBe(
        'deal-stage-option-qualified',
    )
    press('Enter')
    expect([isOpen(), shown()]).toEqual([false, 'qualified'])
})

// 51.194 — THE LIST OPENS ON WHAT IS PICKED. THE REVERT: open on `undefined` in `select`'s
// `openOn` — the first stage is active, `lead` where `proposal` was picked.
test('the list opens with the picked stage active, and Home and End open it at either end', async () => {
    using _select = await mount(StageSelect({}))
    press('ArrowDown')
    press('End')
    press('ArrowUp')
    press(' ')
    expect(shown()).toBe('proposal')
    press('ArrowDown')
    const active = () => options().find((option) => option.active)?.stage
    expect(active()).toBe('proposal')
    press('Escape')
    press('Home')
    expect(active()).toBe('lead')
    press('Escape')
    press('End')
    expect(active()).toBe('won')
})

// 51.196 — A LETTER MOVES TO THE STAGE IT STARTS, opening a shut list, and never narrows it.
// THE REVERT: drop the typeahead from `select`'s shut keys, and `p` opens nothing.
test('typing a letter opens the list on the stage it starts', async () => {
    using _select = await mount(StageSelect({}))
    press('p')
    expect(options()).toHaveLength(4)
    expect(options().find((option) => option.active)?.stage).toBe('proposal')
    press('Enter')
    expect(shown()).toBe('proposal')
})

// 51.198 — ESCAPE SHUTS AND KEEPS THE PICK, and a shut list leaves Escape to the page. THE REVERT:
// hand a shut Escape to the list, and the second one is prevented, so a `<dialog>` never cancels.
test('Escape shuts the list without picking, then is left to the page', async () => {
    using _select = await mount(StageSelect({}))
    press('w')
    press('Enter')
    press('ArrowDown')
    press('ArrowUp')
    expect(press('Escape')).toBe(true)
    expect([isOpen(), shown()]).toEqual([false, 'won'])
    expect(press('Escape')).toBe(false)
})

test('a press opens the list and a second shuts it, a click picks, and focus opens nothing — 51.193, 51.197', async () => {
    using _select = await mount(StageSelect({}))
    trigger().dispatchEvent(new FocusEvent('focus'))
    flushSync()
    expect(isOpen()).toBe(false)
    trigger().click()
    flushSync()
    expect(isOpen()).toBe(true)
    trigger().click()
    flushSync()
    expect(isOpen()).toBe(false)
    trigger().click()
    flushSync()
    ;(document.querySelectorAll('[role=option]')[1] as HTMLElement).click()
    flushSync()
    expect([isOpen(), shown()]).toEqual([false, 'qualified'])
})

// THE REVERT: shut nothing on blur in `select`'s trigger, and the list stays open as focus leaves.
test('leaving the field shuts the list and keeps the pick — 51.199', async () => {
    using _select = await mount(StageSelect({}))
    press('ArrowDown')
    trigger().dispatchEvent(new FocusEvent('blur'))
    flushSync()
    expect([isOpen(), shown()]).toEqual([false, 'Pick a stage'])
})

// THE REVERT: drop `data-placeholder` from `select`'s trigger, and nothing marks an empty field.
test('the trigger is marked while nothing is picked, and the picked stage is marked — 51.200', async () => {
    using _select = await mount(StageSelect({}))
    expect(trigger().hasAttribute('data-placeholder')).toBe(true)
    press('l')
    press('Enter')
    expect(trigger().hasAttribute('data-placeholder')).toBe(false)
    press('ArrowDown')
    press('ArrowDown')
    expect(
        [...document.querySelectorAll('[role=option][data-selected]')].map(
            (option) => option.textContent,
        ),
    ).toEqual(['lead'])
})

// 51.201 — THE PICK IS A FIELD of the form it is in. THE REVERT: render no hidden input, and the
// form submits no stage.
test('a form holding the select submits the picked stage under its name', async () => {
    using _select = await mount(StageSelect({}))
    const submitted = () =>
        new FormData(document.querySelector('form') as HTMLFormElement).getAll(
            'stage',
        )
    expect(submitted()).toEqual([''])
    press('q')
    press('Enter')
    expect(submitted()).toEqual(['qualified'])
})
