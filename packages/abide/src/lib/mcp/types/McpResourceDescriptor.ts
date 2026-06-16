/* One entry in an MCP resources/list result — a file under src/mcp/resources. */
export type McpResourceDescriptor = {
    uri: string
    name: string
    mimeType: string
}
