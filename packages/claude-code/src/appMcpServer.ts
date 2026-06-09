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
        /* Force the app's verbs into the turn-1 prompt. Without this the SDK
        defers MCP tools behind tool search, so the model never sees them upfront
        and reports it only has its built-ins. This app's MCP surface is the whole
        point of the assistant, so it must always load — and the flag blocks
        startup until the server connects (5s cap), surfacing a dead endpoint
        instead of silently yielding an empty toolset. */
        alwaysLoad: true,
    }
}
