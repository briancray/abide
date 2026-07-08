import { GET } from '@abide/abide/server/GET'
import { json } from '@abide/abide/server/json'
import { z } from 'zod'

const users = [
    { id: 'u1', name: 'alice' },
    { id: 'u2', name: 'bob' },
    { id: 'u3', name: 'carol' },
]

const inputSchema = z.object({ limit: z.coerce.number().optional() })

/*
Nested rpc files keep their folders: this file mounts at /rpc/users/list and
— schema'd GET, so MCP and the CLI flip on — becomes the `users-list`
tool/subcommand (slashes become dashes). `limit` rides the query string as a
string, hence z.coerce.
*/
export const list = GET(({ limit }) => json(users.slice(0, limit ?? users.length)), {
    schemas: { input: inputSchema },
})
