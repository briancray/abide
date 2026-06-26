/*
User-facing options for createMcpServer. All fields optional — the
zero-arg call works for any abide project (server info is derived from
package.json by the bundler when MCP is wired into createServer).

- `name` / `version`: identify the server in the MCP `initialize`
  response. Defaults come from the project's package.json.
- `authorize`: optional boundary check. Runs once per MCP request before
  any tool/resource dispatch. Throw HttpError (or any Error) to reject.
  Per-tool authorization stays in the underlying rpc handler.
*/
export type McpServerOptions = {
    name?: string
    version?: string
    authorize?: (request: Request) => Promise<void> | void
}
