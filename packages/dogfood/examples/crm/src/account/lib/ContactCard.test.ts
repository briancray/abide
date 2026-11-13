import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import getContact from '../getContact.handler.ts'

test('an admin reads the deal value', async () => {
    await using app = await createApp()
    const contact = await app.run(async () => await getContact(), {
        principal: { id: 'maya' },
    })
    expect(contact.dealValue).toBe('$48,000')
})

test('sales reads the rest of the contact', async () => {
    await using app = await createApp()
    const contact = await app.run(async () => await getContact(), {
        principal: { id: 'theo' },
    })
    expect(contact.name).toBe('Grace Hopper')
    expect(contact.dealValue).toBeUndefined()
})
