import { expect, test } from 'bun:test'
import { createApp } from '@abide/abide/server'

test('the server paints the density the cookie holds', async () => {
    await using app = await createApp()
    const request = new Request('http://crm.invalid/account', {
        headers: { cookie: 'density=compact' },
    })
    const page = await (await app.fetch(request)).text()
    expect(page).toContain('fields gap-0')
})
