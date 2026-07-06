import type { McpResourceServer } from './types/McpResourceServer.ts'

/*
Process-wide slot for the MCP resource server. createServer assigns it at
boot; dispatchMcpRequest reads it on resources/list + resources/read. Mirrors
the other `*Slot` seams (e.g. logTapSlot) — a single object named after the
file with a mutable field — because the default MCP server is constructed in
the abide:mcp virtual with no args, so the resource server (which needs the
project's resourcesDir + embedded map) is injected out of band.
*/
export const mcpResourceServerSlot: { server: McpResourceServer | undefined } = {
    server: undefined,
}
