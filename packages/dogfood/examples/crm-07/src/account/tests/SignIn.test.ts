import { expect, test } from 'bun:test'
import { principal } from '@abide/abide'
import { createApp } from '@abide/abide/server'
import { asMember } from './signedIn.ts'

const signIn = (email: string) =>
    new Request('http://crm.invalid/account/signIn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
    })

test('signing in seals the caller into an HttpOnly cookie', async () => {
    await using app = await createApp()
    const answer = await app.fetch(signIn('maya@crm.example'))
    const [sealed = ''] = answer.headers.getSetCookie()
    expect(sealed).toStartWith('abide-principal=')
    expect(sealed).toContain('HttpOnly')
})

test('a request carrying the cookie is signed in', async () => {
    await using app = await createApp()
    const request = await asMember(app, 'maya@crm.example')
    const signedIn = await app.run(async () => await principal.authenticated, {
        request,
    })
    expect(signedIn).toBe(true)
})
