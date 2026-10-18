import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'
import exportContacts from '../exportContacts.ts'
import { asMember } from './signedIn.ts'

test('an admin exports every contact', async () => {
    await using app = await createApp()
    const request = await asMember(app, 'maya@crm.example')
    const contacts = await app.run(async () => await exportContacts(), {
        request,
    })
    expect(contacts).toHaveLength(3)
})

test('sales and a signed-out caller are refused 403', async () => {
    await using app = await createApp()
    for (const email of ['theo@crm.example', undefined]) {
        const request = await asMember(app, email)
        try {
            await app.run(async () => await exportContacts(), { request })
            throw new Error('the export was not refused')
        } catch (refusal) {
            if (!exportContacts.isError(refusal, 'HttpError')) throw refusal
            expect(refusal.status).toBe(403)
        }
    }
})
