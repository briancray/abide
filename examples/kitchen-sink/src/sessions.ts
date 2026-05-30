/*
In-memory cookie session store + helpers. Used by getSession / login /
logout to demonstrate the auth showcase under src/browser/pages/auth/. Anything
that needs the inbound Request reaches for `request()` from belte/server
— no plumbing.
*/
import { request } from '@briancray/belte/server/request'

const sessions = new Map<string, { user: string }>()

export const SESSION_COOKIE = 'sid'

export function createSession(user: string): string {
    const id = crypto.randomUUID()
    sessions.set(id, { user })
    return id
}

export function getSession(id: string | undefined): { user: string } | undefined {
    return id ? sessions.get(id) : undefined
}

export function destroySession(id: string | undefined): void {
    if (id) {
        sessions.delete(id)
    }
}

export function readSessionCookie(): string | undefined {
    const cookie = request().headers.get('cookie') ?? ''
    const match = cookie.split(/;\s*/).find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : undefined
}
