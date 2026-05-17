import type { ApiHandler } from 'belte/types/ApiHandler'
import { createSession, SESSION_COOKIE } from '../sessions.ts'

export const POST: ApiHandler = async (req) => {
    const form = await req.formData()
    const username = String(form.get('username') ?? '').trim()
    if (!username) {
        return { data: { error: 'username is required' } }
    }
    const sid = createSession(username)
    return new Response(undefined, {
        status: 303,
        headers: {
            Location: '/dashboard',
            'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`,
        },
    })
}
