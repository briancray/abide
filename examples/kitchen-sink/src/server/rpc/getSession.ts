import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'
import { getSession as readSession, readSessionCookie } from '../../sessions.ts'

export const getSession = GET(() => {
    const session: { user: string } | null = readSession(readSessionCookie()) ?? null
    return json(session)
})
