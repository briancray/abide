import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContactTitle from './ContactTitle.abide'

const view = () =>
    document.querySelector('[data-inline-edit=view]') as HTMLButtonElement
const input = () =>
    document.querySelector('[data-inline-edit=input]') as HTMLInputElement
const settle = async () => {
    await Bun.sleep(1)
    flushSync()
}
const enter = async (text: string) => {
    input().value = text
    input().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    )
    await settle()
}

test('a title is renamed where it stands, and a refused one stays open', async () => {
    using _title = await mount(ContactTitle({}))
    expect(input().hidden).toBe(true)
    view().click()
    await settle()
    expect([input().hidden, input().value, document.activeElement]).toEqual([
        false,
        'Head of procurement',
        input(),
    ])
    await enter('  ')
    expect(document.querySelector('.status')?.textContent).toBe(
        'A title cannot be blank',
    )
    expect(input().hidden).toBe(false)
    await enter('Chief procurement officer')
    expect(view().textContent).toBe('Chief procurement officer')
    expect([input().hidden, document.activeElement]).toEqual([true, view()])
})
