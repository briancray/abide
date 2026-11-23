import { expect, test } from 'bun:test'

import { flushSync } from '@abide/abide'
import { mount } from '@abide/harness/abide'

import ContactFind from './ContactFind.abide'

test('what is typed is marked in each name that holds it', async () => {
    using _find = await mount(ContactFind({}))
    const field = document.querySelector('input') as HTMLInputElement
    field.value = 'jo'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    const names = [...document.querySelectorAll('li')].map(
        (name) => name.textContent,
    )
    expect(names).toEqual(['Katherine Johnson'])
    expect(document.querySelector('mark')?.textContent).toBe('Jo')
    expect(document.querySelector('mark')?.getAttribute('data-highlight')).toBe(
        'match',
    )
})
