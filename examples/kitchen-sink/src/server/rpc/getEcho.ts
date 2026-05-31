import { GET } from '@briancray/belte/server/GET'
import { json } from '@briancray/belte/server/json'
import { z } from 'zod'

const inputSchema = z.object({ message: z.string() })

/*
GET — args arrive as URL search params. An `inputSchema` validates them
and gates the non-browser surfaces: this rpc auto-exposes as an MCP tool
`getEcho` (see /mcp) and as a CLI subcommand `getEcho` (see /cli). The
schema and zod stay server-side — the bundler swaps this module for a
remote proxy in the browser bundle.
*/
export const getEcho = GET(({ message }) => json({ method: 'GET' as const, message }), {
    inputSchema,
})
