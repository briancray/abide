/*
Public shape returned by createMcpServer. The bun route handler at
/__abide/mcp delegates inbound requests to `handle(request)`, which
parses the JSON-RPC envelope, dispatches to tools/resources, and returns
a Response carrying the JSON-RPC reply.
*/
export type McpServer = {
    handle(request: Request): Promise<Response>
}
