/*
In-memory cookie session store + helpers. Used by getSession / login /
logout to demonstrate the auth showcase under src/ui/pages/auth/.
The cookie jar is `cookies()` from abide/server — `Bun.CookieMap` for the
in-flight request, readable from any scope (rpc handler, page script,
layout) with no plumbing; `set`/`delete` mutations flush as `Set-Cookie`
headers when the handler returns.
*/
import { cookies } from '@abide/abide/server/cookies'

const sessions = new Map<string, { user: string }>()

export const SESSION_COOKIE = 'sid'

export function createSession(user: string): string {
    const id = crypto.randomUUID()
    sessions.set(id, { user })
    cookies().set(SESSION_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' })
    return id
}

export function getSession(): { user: string } | undefined {
    const id = cookies().get(SESSION_COOKIE)
    return id ? sessions.get(id) : undefined
}

/*
Session lookup from a raw Request, for hooks that run outside any request
scope — the app.ts health hook answers ahead of all middleware, before the
scope (and so cookies()) exists, so it parses the Cookie header itself.
*/
export function sessionFromRequest(request: Request): { user: string } | undefined {
    const id = new Bun.CookieMap(request.headers.get('cookie') ?? '').get(SESSION_COOKIE)
    return id ? sessions.get(id) : undefined
}

export function destroySession(): void {
    const id = cookies().get(SESSION_COOKIE)
    if (id) {
        sessions.delete(id)
    }
    cookies().delete({ name: SESSION_COOKIE, path: '/' })
}
