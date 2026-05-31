import { json } from '@briancray/belte/server/json'
import { POST } from '@briancray/belte/server/POST'
import { z } from 'zod'

const inputSchema = z.object({ message: z.string() })

/*
POST — args arrive in the JSON request body. An inputSchema auto-exposes
the rpc to the CLI. MCP only auto-exposes read-only verbs (GET/HEAD), so
this mutating verb opts in explicitly with `clients: { mcp: true }` —
letting a model create an echo through the MCP tool too.
*/
export const createEcho = POST(
    ({ message }) => json({ method: 'POST' as const, message }, { status: 201 }),
    { inputSchema, clients: { mcp: true } },
)
