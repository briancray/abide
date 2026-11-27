import { expect, test } from 'bun:test'

import { principal } from '@abide/abide'
import { createApp } from '@abide/abide/server'
import { mount, settled } from '@abide/harness/abide'

import SignIn from './SignIn.abide'

const button = () => document.querySelector('button') as HTMLButtonElement

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

// 38.236 — A MOUNTED SIGN-IN SIGNS THE MOUNT IN: the call reads the session the mount opened, and
// the page reads who it signed in as. THE REVERT: have `within` read the request scope alone — the
// test above built the principal outside every request, and the mount throws "principal() was
// called outside a request".
test('a click signs the mounted page in, and another signs it out', async () => {
    using _signIn = await mount(SignIn({}))
    button().click()
    await settled()
    expect(button().textContent).toBe('Sign out')
    button().click()
    await settled()
    expect(button().textContent).toBe('Sign in')
})

// 38.236 — A MOUNT AFTER THE LAST ONE STOPPED IS A FRESH BROWSER, signed out. THE REVERT: drop
// `forgetPrincipalMembers` from `testMount.ts`; run alone, the principal the first session signed in
// is still served — "Sign out" where "Sign in" is due — and after the tests above, the mount throws
// the "principal() was called outside a request" they left.
test('the next mount starts signed out', async () => {
    {
        using _first = await mount(SignIn({}))
        button().click()
        await settled()
        expect(button().textContent).toBe('Sign out')
    }
    using _second = await mount(SignIn({}))
    expect(button().textContent).toBe('Sign in')
})
