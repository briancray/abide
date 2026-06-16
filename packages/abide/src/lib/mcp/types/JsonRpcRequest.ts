/*
JSON-RPC 2.0 request frame as MCP delivers it over Streamable HTTP. The
`id` is absent for notifications (which we don't currently receive from
clients but accept silently). `method` is a string like "tools/list" or
"resources/read".
*/
export type JsonRpcRequest = {
    jsonrpc: '2.0'
    id?: string | number
    method: string
    params?: Record<string, unknown>
}
