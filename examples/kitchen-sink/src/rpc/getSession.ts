import { GET } from 'belte/rpc'
import { json } from 'belte/response'
import { getSession as readSession, readSessionCookie } from '../sessions.ts'

export const getSession = GET<undefined, { user: string } | null>(() => {
    const session = readSession(readSessionCookie()) ?? null
    return json(session)
})
