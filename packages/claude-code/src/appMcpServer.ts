/* The single MCP server entry wiring Claude Code to a belte app's machine
surface. Plain data — no SDK types — so it serializes equally into the engine's
query() options and the `claude --mcp-config` JSON the TUI launcher writes. The
registration KEY (the prefix) is chosen by the caller via mcpServerNameForApp;
this only describes the transport. */
export function appMcpServer(origin: string, mcpToken?: string) {
    return {
        type: 'http' as const,
        url: `${origin}/__belte/mcp`,
        ...(mcpToken ? { headers: { Authorization: `Bearer ${mcpToken}` } } : {}),
    }
}
