import { handler } from 'belte/rpc/handler'
import { getSession as readSession, readSessionCookie } from '../sessions.ts'

export const getSession = handler.GET<undefined, { user: string } | null>((_args, req) => {
    const session = readSession(readSessionCookie(req)) ?? null
    return Response.json(session)
})
