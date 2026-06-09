/* Normalizes an app's MCP server name into a token legal in the
`mcp__<name>__<tool>` prefix. Drops the npm scope's leading `@` but keeps the
scope for uniqueness (`@acme/shop` -> `acme_shop`); every other non-word run
collapses to `_`, and edge underscores are trimmed. Deterministic — same input,
same token — so permission rules authored against the prefix stay valid across
deploys. */
export function sanitizeMcpName(name: string): string {
    return name
        .replace(/^@/, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
}
