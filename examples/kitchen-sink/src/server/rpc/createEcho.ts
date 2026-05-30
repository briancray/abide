import { json } from '@briancray/belte/server/json'
import { POST } from '@briancray/belte/server/POST'
import { z } from 'zod'

const schema = z.object({ message: z.string() })

/* POST — args arrive in the JSON request body. Schema auto-exposes the rpc to MCP + CLI. */
export const createEcho = POST(
    ({ message }) => json({ method: 'POST' as const, message }, { status: 201 }),
    { schema },
)
