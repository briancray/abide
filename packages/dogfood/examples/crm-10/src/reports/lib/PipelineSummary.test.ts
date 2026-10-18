import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

// Run from the app's own directory: `createApp` finds the app there.
test('the summary answers in process as it does on the wire', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/reports/getSummary'),
    )
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ open: 3, pipeline: 15500 })
})
