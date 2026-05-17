import type { ApiHandler } from 'belte/types/ApiHandler'
import { destroySession, readSessionCookie, SESSION_COOKIE } from '../sessions.ts'

export const POST: ApiHandler = (req) => {
    destroySession(readSessionCookie(req))
    return new Response(undefined, {
        status: 303,
        headers: {
            Location: '/',
            'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        },
    })
}
