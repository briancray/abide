import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'
import { pool } from '../lib/pool'

// Run from the app's own directory: `createApp` finds the app there (38.25).
test('the pool handler answers in process as it does on the wire', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request(
            'http://app.invalid/ship/call-your-app-from-a-test/poolState',
        ),
    )
    expect(answer.status).toBe(200)
    expect(answer.headers.get('traceresponse')).not.toBeNull()
})

test('stopping the app closes the pool onStart opened', async () => {
    const app = await createApp()
    expect(pool.connected).toBe(true)
    await app.stop()
    expect(pool.connected).toBe(false)
})
