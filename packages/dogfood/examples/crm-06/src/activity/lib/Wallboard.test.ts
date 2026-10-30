import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

test('a caller asking for nothing in particular is sent events', async () => {
    await using app = await createApp()
    const answer = await app.fetch(
        new Request('http://crm.invalid/activity/ticker'),
    )
    expect(answer.headers.get('content-type')).toStartWith('text/event-stream')
    expect(await answer.text()).toContain(
        'data: {"account":"Hopper & Co","stage":"Won"}\n',
    )
})
