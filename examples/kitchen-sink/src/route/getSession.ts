import { GET } from 'belte/route'
import { json } from 'belte/respond'
import { getSession as readSession, readSessionCookie } from '../sessions.ts'

export const getSession = GET<undefined, { user: string } | null>(() => {
    const session = readSession(readSessionCookie()) ?? null
    return json(session)
})
