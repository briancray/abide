import type { McpResourceContents } from './McpResourceContents.ts'
import type { McpResourceDescriptor } from './McpResourceDescriptor.ts'

/*
Serves the project's src/mcp/resources files to the MCP dispatcher. `list`
backs resources/list; `read` backs resources/read and resolves to undefined
for an unknown uri.
*/
export type McpResourceServer = {
    list(): Promise<McpResourceDescriptor[]>
    read(uri: string): Promise<McpResourceContents | undefined>
}
