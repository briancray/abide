import { expect, test } from 'bun:test'
import { principal } from '@abide/abide'
import { createApp } from '@abide/abide/server'

const signIn = (email: string) =>
    new Request('http://crm.invalid/account/signIn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
    })

test('signing in seals the id into an HttpOnly cookie', async () => {
    await using app = await createApp()
    const answer = await app.fetch(signIn('maya@crm.example'))
    const [sealed = ''] = answer.headers.getSetCookie()
    expect(sealed).toStartWith('abide-principal=')
    expect(sealed).toContain('HttpOnly')

    // The seal is a JWT; its payload is the id, and the times abide adds.
    const token = sealed.split(';')[0]?.split('=')[1] ?? ''
    const payload = JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    )
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'id'])
})

test('a request carrying the cookie is signed in', async () => {
    await using app = await createApp()
    const answer = await app.fetch(signIn('maya@crm.example'))
    const [sealed = ''] = answer.headers.getSetCookie()
    const request = new Request('http://crm.invalid/', {
        headers: { cookie: sealed.split(';')[0] ?? '' },
    })
    const signedIn = await app.run(async () => await principal.authenticated, {
        request,
    })
    expect(signedIn).toBe(true)
})
