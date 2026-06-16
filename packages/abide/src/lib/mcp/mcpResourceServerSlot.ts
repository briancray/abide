import type { McpResourceServer } from './types/McpResourceServer.ts'

/*
Process-wide slot for the MCP resource server. createServer assigns it at
boot; dispatchMcpRequest reads it on resources/list + resources/read. Mirrors
the registryManifests slot — the default MCP server is constructed in the
abide:mcp virtual with no args, so the resource server (which needs the
project's resourcesDir + embedded map) is injected out of band.
*/
let resourceServer: McpResourceServer | undefined

export function setMcpResourceServer(value: McpResourceServer): void {
    resourceServer = value
}

export function getMcpResourceServer(): McpResourceServer | undefined {
    return resourceServer
}
