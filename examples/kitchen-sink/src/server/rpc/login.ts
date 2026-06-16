import { error } from '@abide/abide/server/error'
import { POST } from '@abide/abide/server/POST'
import { redirect } from '@abide/abide/server/redirect'
import { createSession } from '../../sessions.ts'

/*
Form-style POST. The login page posts a `<form>` here, so args arrive as
FormData (no JSON body). On success `createSession` writes the session
cookie through `cookies().set(...)` — the mutation flushes as `Set-Cookie`
when this handler returns, riding the 303 redirect (POST followed by GET,
the idiomatic "after a write, navigate the browser" pattern).

The session is intentionally trivial: any non-empty username works. The
point is the cookie path (cookies() → session lookup) and how the layout's
`cache(getSession)()` picks up the new identity without any client-side
state plumbing.
*/
export const login = POST<{ username: string }>((args) => {
    const username = String(args?.username ?? '').trim()
    if (!username) {
        return error(400, 'username is required')
    }
    createSession(username)
    return redirect('/auth/dashboard', 303)
})
