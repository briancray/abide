import { handler } from 'belte/rpc/handler'
import { createSession, SESSION_COOKIE } from '../sessions.ts'

export const login = handler.POST<{ username: string }, never>(async (args) => {
    const username = String(args?.username ?? '').trim()
    if (!username) {
        return new Response('username is required', { status: 400 })
    }
    const sid = createSession(username)
    return new Response(undefined, {
        status: 303,
        headers: {
            Location: '/dashboard',
            'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`,
        },
    })
})
