import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

// Each request is a caller of its own, as each open tab is.
test('what one caller logs, another caller reads', async () => {
    await using app = await createApp()
    await app.fetch(
        new Request('http://crm.invalid/activity/logToFeed', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ account: 'langley', kind: 'Call' }),
        }),
    )
    const answer = await app.fetch(
        new Request('http://crm.invalid/activity/feed?account=langley'),
    )
    const entries = (await answer.json()) as { kind: string }[]
    expect(entries.map((entry) => entry.kind)).toEqual(['Call'])
})
