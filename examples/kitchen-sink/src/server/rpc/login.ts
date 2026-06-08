import { error } from '@belte/belte/server/error'
import { POST } from '@belte/belte/server/POST'
import { createSession, SESSION_COOKIE } from '../../sessions.ts'

/*
Form-style POST. The kitchen-sink layout posts a `<form>` here, so args
arrive as FormData (no JSON body). On success we set the session cookie
and redirect with 303 — POST followed by GET — which is the idiomatic
"after a write, navigate the browser" pattern.

The session is intentionally trivial: any non-empty username works. The
point is to show the cookie path (request() → cookie → session lookup)
and how the layout's `cache(getSession)()` picks up the new identity
without any client-side state plumbing.
*/
export const login = POST<{ username: string }>((args) => {
    const username = String(args?.username ?? '').trim()
    if (!username) {
        return error(400, 'username is required')
    }
    const sid = createSession(username)
    return new Response(undefined, {
        status: 303,
        headers: {
            Location: '/auth/dashboard',
            'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`,
        },
    })
})
