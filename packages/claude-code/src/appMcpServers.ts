import { appMcpServer } from './appMcpServer.ts'
import { mcpServerNameForApp } from './mcpServerNameForApp.ts'

/* The app's MCP server map, keyed under its discovered `mcp__<name>__*` prefix.
The "discover the name, then key the transport under it" pair is the actual
contract every face shares — the engine spreads this map into query options, the
TUI launcher stringifies it into `--mcp-config` — so it lives here once and the
prefix can't drift between the headless and interactive paths. */
export async function appMcpServers(
    origin: string,
    mcpToken?: string,
): Promise<Record<string, ReturnType<typeof appMcpServer>>> {
    const name = await mcpServerNameForApp(origin, mcpToken)
    return { [name]: appMcpServer(origin, mcpToken) }
}
