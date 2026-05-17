import type { ApiHandler } from 'belte/types/ApiHandler'
import { getSession, readSessionCookie } from '../sessions.ts'

export const GET: ApiHandler = (req) => {
    const session = getSession(readSessionCookie(req))
    if (!session) {
        return { redirect: '/login' }
    }
    return {}
}
