import type { ResolveHook } from 'belte/types/ResolveHook'
import { getSession, readSessionCookie } from '../sessions.ts'

export const resolve: ResolveHook = ({ req }) => {
    const session = getSession(readSessionCookie(req))
    return {
        data: {
            requestedAt: new Date().toISOString(),
            user: session?.user,
        },
    }
}
