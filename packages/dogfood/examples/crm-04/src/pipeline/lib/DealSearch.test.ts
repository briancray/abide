import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import DealSearch from './DealSearch.abide'
import { LOADS } from './LOADS.server.ts'

function type(text: string): void {
    const input = document.querySelector('input')
    if (!input) throw new Error('no search box')
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
}

test('typing a word is one search, not one per keystroke', async () => {
    using _search = await mount(DealSearch({}))
    await Bun.sleep(800)
    const before = LOADS.search ?? 0
    for (const typed of ['h', 'ho', 'hop', 'hopp', 'hoppe', 'hopper']) {
        type(typed)
        await Bun.sleep(30)
    }
    await Bun.sleep(800)
    expect((LOADS.search ?? 0) - before).toBe(1)
    const names = [...document.querySelectorAll('li strong')]
    expect(names.map((each) => each.textContent)).toEqual([
        'Hopper & Co pilot',
        'Hopper & Co expansion',
        'Hopper & Co training',
    ])
})
