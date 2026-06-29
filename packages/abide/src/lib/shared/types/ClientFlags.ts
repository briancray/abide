/*
Which client surfaces a rpc or socket is exposed to. Browser is the
historical default. CLI flips on for any rpc or socket with a Standard
Schema. MCP flips on automatically only for read-only rpcs (GET/HEAD)
with a schema, and for any socket with a schema — mutating rpcs require
an explicit clients.mcp even when a schema is present. Explicit values
always win.
*/
export type ClientFlags = {
    browser: boolean
    mcp: boolean
    cli: boolean
}
