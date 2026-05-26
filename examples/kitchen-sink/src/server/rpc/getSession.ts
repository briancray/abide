import { json } from 'belte/server'
import { GET } from 'belte/server'
import { getSession as readSession, readSessionCookie } from '../../sessions.ts'

export const getSession = GET(() => {
    const session: { user: string } | null = readSession(readSessionCookie()) ?? null
    return json(session)
})
