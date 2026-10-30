import { expect, test } from 'bun:test'

import listContacts from '../listContacts.handler.ts'

test('the handler the list reads answers with every contact', async () => {
    const contacts = await listContacts()
    expect(contacts.map((contact) => contact.name)).toEqual([
        'Ada Lovelace',
        'Grace Hopper',
        'Katherine Johnson',
    ])
})
