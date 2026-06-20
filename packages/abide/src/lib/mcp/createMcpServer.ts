import { NO_STORE } from '../shared/CACHE_CONTROL_VALUES.ts'
import { TEXT_PLAIN } from '../shared/TEXT_PLAIN.ts'
import { dispatchMcpRequest } from './dispatchMcpRequest.ts'
import type { McpServer } from './types/McpServer.ts'
import type { McpServerOptions } from './types/McpServerOptions.ts'

const DEFAULT_NAME = 'abide-app'
const DEFAULT_VERSION = '0.0.0'

/*
Constructs an MCP server bound to the project's rpc registry. Returns an
object whose `handle(request)` is the function the bun route at
/__abide/mcp invokes. Framework-internal — the abide:mcp virtual
default-constructs it; there is no user-authored server module. Server
name/version default from package.json.

Tools are derived from every verb with `clients.mcp: true` (auto-on for
read-only verbs that carry a schema; mutating verbs opt in explicitly)
and from every socket with `clients.mcp: true` (a `<base>-tail` read tool
plus a `<base>-publish` tool when clientPublish is set). The HTTP verb
feeds each rpc tool's annotations. Auth inherits from the inbound request
— bearer / cookie headers flow into the synthesized Request that hits
each rpc handler. An optional `authorize` hook in opts can short-circuit
the request before any tool dispatches.
*/
// @documentation mcp
export function createMcpServer(opts: McpServerOptions = {}): McpServer {
    const serverInfo = {
        name: opts.name ?? DEFAULT_NAME,
        version: opts.version ?? DEFAULT_VERSION,
    }
    return {
        async handle(request: Request): Promise<Response> {
            if (request.method !== 'POST') {
                return new Response('Method Not Allowed', {
                    status: 405,
                    headers: {
                        Allow: 'POST',
                        'Content-Type': TEXT_PLAIN,
                        'Cache-Control': NO_STORE,
                    },
                })
            }
            const envelope = await dispatchMcpRequest(request, opts, serverInfo)
            return Response.json(envelope, { headers: { 'Cache-Control': NO_STORE } })
        },
    }
}
