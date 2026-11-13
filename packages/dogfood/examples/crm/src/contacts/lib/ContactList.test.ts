import { expect, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import ContactList from './ContactList.abide'

const names = () =>
    [...document.querySelectorAll('strong')].map((name) => name.textContent)

test('the list is empty until the handler answers, then fills in', async () => {
    using _list = await mount(ContactList({}))
    expect(names()).toEqual([])
    await Bun.sleep(500)
    expect(names()).toEqual([
        'Ada Lovelace',
        'Grace Hopper',
        'Katherine Johnson',
    ])
})
