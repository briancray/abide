// 56.24-56.28 — `inlineEdit`, its parts spread on a button and an input as a template spreads them.

import { afterEach, expect, test } from 'bun:test'

import { flushSync, inlineEdit, reactive } from '#shared'
import type { InlineEditOptions } from '#shared/inlineEdit.ts'

import { bindPart } from './bindPart.ts'

const bound: (() => void)[] = []
afterEach(() => {
    for (const release of bound.splice(0)) release()
    document.body.replaceChildren()
})

const settle = async () => {
    await Bun.sleep(0)
    flushSync()
}

function standing(options: InlineEditOptions) {
    const name = inlineEdit(options)
    const view = document.createElement('button')
    const input = document.createElement('input')
    document.body.append(view, input)
    for (const [element, part] of [
        [view, name.view],
        [input, name.input],
    ] as const)
        for (const [key, value] of Object.entries(part))
            if (key === 'bind:element') bound.push(bindPart(part, element))
            else if (key.startsWith('on'))
                element.addEventListener(key.slice(2), value as EventListener)
    const type = async (text: string, key: string) => {
        input.value = text
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key, cancelable: true }),
        )
        await settle()
    }
    return { name, view, input, type }
}

// THE REVERT: drop the start of an edit from `view`'s click, and a press shows no field.
test('a press turns the text into its field, holding the value, selected and focused — 56.24', async () => {
    const { name, view, input } = standing({
        value: reactive('Engine renewal'),
    })
    expect([name.view.hidden, name.input.hidden]).toEqual([false, true])
    view.click()
    await settle()
    expect([name.editing(), name.view.hidden, name.input.hidden]).toEqual([
        true,
        true,
        false,
    ])
    expect([input.value, document.activeElement]).toEqual([
        'Engine renewal',
        input,
    ])
})

// THE REVERT: write `value` before the save is waited on, and a save that fails changes it anyway.
test('Enter saves before the value takes it, and a failed save keeps the field open with why — 56.25, 56.26', async () => {
    const saved: string[] = []
    let refuse = false
    // The first save is held open until the test lets it go, so `busy` is read while it is in flight
    // however long `type` takes on a loaded machine.
    let release = () => {}
    let held = true
    const { name, view, type } = standing({
        value: reactive('Engine renewal'),
        save: async (text) => {
            if (held) {
                held = false
                await new Promise<void>((resolve) => {
                    release = resolve
                })
            }
            if (refuse) throw new Error('Names are unique')
            saved.push(text)
        },
    })
    view.click()
    await settle()
    refuse = true
    await type('Babbage pilot', 'Enter')
    expect(name.busy).toBe(true)
    release()
    await Bun.sleep(5)
    flushSync()
    expect([name.value(), name.editing(), name.error]).toEqual([
        'Engine renewal',
        true,
        'Names are unique',
    ])
    refuse = false
    await type('Engine renewal, phase 2', 'Enter')
    await Bun.sleep(5)
    flushSync()
    expect([name.value(), name.editing(), name.error]).toEqual([
        'Engine renewal, phase 2',
        false,
        undefined,
    ])
    expect(saved).toEqual(['Engine renewal, phase 2'])
})

// THE REVERT: hand focus to nothing on finishing, and it falls to the page.
test('Escape puts the value back and hands focus to the text, and leaving saves — 56.27, 56.28', async () => {
    const { name, view, input, type } = standing({
        value: reactive('Engine renewal'),
    })
    view.click()
    await settle()
    await type('Scratch', 'Escape')
    expect([name.value(), name.editing(), document.activeElement]).toEqual([
        'Engine renewal',
        false,
        view,
    ])
    view.click()
    await settle()
    input.value = 'Hopper expansion'
    input.dispatchEvent(new FocusEvent('blur'))
    await settle()
    expect(name.value()).toBe('Hopper expansion')
})
