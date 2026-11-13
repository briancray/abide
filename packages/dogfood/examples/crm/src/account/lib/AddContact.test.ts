import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('adding a contact answers 201, and where it lives', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/account/addContact', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Katherine Johnson' }),
        }),
    )
    expect(answer.status).toBe(201)
    const { id } = await answer.json()
    expect(answer.headers.get('location')).toBe(`/contacts/${id}`)
})
