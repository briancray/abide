/*
The MCP endpoint: inbound JSON-RPC over HTTP delegated to the app's `McpServer.handle`,
mounted only when an `mcp` is configured. Framework-internal (`/__abide/*`). Shared so the
router mount and the boot-time disclosure warning name the one path.
*/
export const MCP_PATH = '/__abide/mcp'
