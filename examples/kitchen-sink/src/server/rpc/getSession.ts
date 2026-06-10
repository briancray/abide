import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { getSession as readSession } from '../../sessions.ts'

/*
Reads the session for the inbound cookie via `cookies()` (inside
readSession). In-process calls (SSR, MCP) forward the `cookie` header onto
the synthesized Request, so the same line answers identically during SSR
and over the wire.
*/
export const getSession = GET(() => {
    const session: { user: string } | null = readSession() ?? null
    return json(session)
})
