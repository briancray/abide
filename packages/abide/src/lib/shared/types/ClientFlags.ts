/*
Which client surfaces a rpc or socket is exposed to. Browser is the
historical default; MCP and CLI flip on automatically when the
declaration carries a Standard Schema (the schema is what makes the
non-browser surfaces safe to advertise). Explicit values always win.
*/
export type ClientFlags = {
    browser: boolean
    mcp: boolean
    cli: boolean
}
