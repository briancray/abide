import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('RETRIES=5 in .env overrides the default of 3, as a number', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/ops/getRetries'),
    )
    expect(await answer.json()).toEqual({ retries: 5 })
})
