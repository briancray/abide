import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('the handler is an operation, with its sentence and type', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/__abide/openapi.json'),
    )
    const document = await answer.json()
    const operation = document.paths['/assistant/searchContacts'].get
    expect(operation.description).toBe(
        'The contacts whose name contains `name`.',
    )
    expect(operation.parameters).toEqual([
        {
            name: 'name',
            in: 'query',
            required: true,
            schema: { type: 'string' },
        },
    ])
})
