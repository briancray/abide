import { POST } from '@briancray/belte/server/POST'
import { destroySession, readSessionCookie, SESSION_COOKIE } from '../../sessions.ts'

export const logout = POST(() => {
    destroySession(readSessionCookie())
    return new Response(undefined, {
        status: 303,
        headers: {
            Location: '/',
            'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        },
    })
})
