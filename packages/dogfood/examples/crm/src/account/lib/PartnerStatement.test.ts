import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

function askAs(origin: string): Request {
    return new Request('http://crm.invalid/account/getStatement', {
        headers: { origin },
    })
}

test('the partner is named back, and no one else is', async () => {
    await using app = await createApp()
    const partner = await app.fetch(askAs('https://books.example'))
    expect(partner.headers.get('access-control-allow-origin')).toBe(
        'https://books.example',
    )
    const stranger = await app.fetch(askAs('https://elsewhere.example'))
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull()
})
