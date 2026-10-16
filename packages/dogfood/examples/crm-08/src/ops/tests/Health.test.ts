import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test('the health check carries the database beside the baseline', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/__abide/health'),
    )
    const account = await answer.json()
    expect(account.database).toBe('connected')
    expect(typeof account.startedAt).toBe('string')
})
