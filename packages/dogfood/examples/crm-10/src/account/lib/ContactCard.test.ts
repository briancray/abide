import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'
import getContact from '../getContact.ts'
import { asMember } from './signedIn.ts'

test('an admin reads the deal value', async () => {
    await using app = await createApp()
    const request = await asMember(app, 'maya@crm.example')
    const contact = await app.run(async () => await getContact(), { request })
    expect(contact.dealValue).toBe('$48,000')
})

test('sales reads the rest of the contact', async () => {
    await using app = await createApp()
    const request = await asMember(app, 'theo@crm.example')
    const contact = await app.run(async () => await getContact(), { request })
    expect(contact.name).toBe('Grace Hopper')
    expect(contact.dealValue).toBeUndefined()
})
