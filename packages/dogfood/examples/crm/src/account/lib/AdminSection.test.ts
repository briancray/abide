import { expect, test } from 'bun:test'

import { createApp } from '@abide/abide/server'

const signedInAs = async (
    app: { fetch: (request: Request) => Promise<Response> },
    email: string,
) => {
    const answer = await app.fetch(
        new Request('http://crm.invalid/account/signIn', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email }),
        }),
    )
    return answer.headers.getSetCookie()[0]?.split(';')[0] ?? ''
}

test('a page is refused as a page, a handler as Problem Details', async () => {
    await using app = await createApp()
    const cookie = await signedInAs(app, 'theo@crm.example')
    const ask = (path: string) =>
        app.fetch(
            new Request(`http://crm.invalid${path}`, { headers: { cookie } }),
        )

    const page = await ask('/account/admin')
    expect(page.status).toBe(403)
    expect(await page.text()).toContain('Not for you')

    const handler = await ask('/account/admin/getTeam')
    expect(handler.status).toBe(403)
    expect(handler.headers.get('content-type')).toStartWith(
        'application/problem+json',
    )
})

test('an admin is let through to both', async () => {
    await using app = await createApp()
    const cookie = await signedInAs(app, 'maya@crm.example')
    const ask = (path: string) =>
        app.fetch(
            new Request(`http://crm.invalid${path}`, { headers: { cookie } }),
        )

    expect((await ask('/account/admin')).status).toBe(200)
    expect(await (await ask('/account/admin/getTeam')).json()).toHaveLength(2)
})
