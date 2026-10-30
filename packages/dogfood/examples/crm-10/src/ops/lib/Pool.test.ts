import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('the pool is connected before the first request is answered', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/ops/getPool'),
    )
    const { connectedAt, upAt } = await answer.json()
    expect(connectedAt).not.toBe('')
    expect(connectedAt <= upAt).toBe(true)
})
