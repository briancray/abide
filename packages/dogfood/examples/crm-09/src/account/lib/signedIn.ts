import type { App } from '@abide/abide/server'

/** A request to `path` carrying the cookie a sign-in as `email` left. */
export async function asMember(
    app: App,
    email: string | undefined,
    path = '/',
): Promise<Request> {
    if (email === undefined) return new Request(`http://crm.invalid${path}`)
    const answer = await app.fetch(
        new Request('http://crm.invalid/account/signIn', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email }),
        }),
    )
    const [sealed = ''] = answer.headers.getSetCookie()
    return new Request(`http://crm.invalid${path}`, {
        headers: { cookie: sealed.split(';')[0] ?? '' },
    })
}
