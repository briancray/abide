import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

import exportContacts from '../exportContacts.handler.ts'

test('an admin exports every contact', async () => {
    await using app = await createApp()
    const contacts = await app.run(async () => await exportContacts(), {
        principal: { id: 'maya' },
    })
    expect(contacts).toHaveLength(3)
})

test('sales and a signed-out caller are refused 403', async () => {
    await using app = await createApp()
    const callers = [
        { principal: { id: 'theo' } },
        { request: new Request('http://crm.invalid/') },
    ]
    for (const caller of callers) {
        try {
            await app.run(async () => await exportContacts(), caller)
            throw new Error('the export was not refused')
        } catch (refusal) {
            if (!exportContacts.isError(refusal, 'HttpError')) throw refusal
            expect(refusal.status).toBe(403)
        }
    }
})
