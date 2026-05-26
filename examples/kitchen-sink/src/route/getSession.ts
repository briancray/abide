import { json } from 'belte/respond'
import { GET } from 'belte/route'
import { getSession as readSession, readSessionCookie } from '../sessions.ts'

export const getSession = GET(() => {
    const session: { user: string } | null = readSession(readSessionCookie()) ?? null
    return json(session)
})
