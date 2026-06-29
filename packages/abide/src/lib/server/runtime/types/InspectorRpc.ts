/*
One declared RPC projected for the inspector: the registry entry reduced to
the serializable facts the UI renders — where it mounts, its method, which
non-browser surfaces advertise it, and its argument/result shapes as JSON
Schema. Schemas project through jsonSchemaForSchema (same as MCP/OpenAPI), so
a rpc whose library can't render a schema still lists with an opaque shape.
*/
export type InspectorRpc = {
    /* Registry key — the rpc URL the rpc mounts at (e.g. /rpc/users/create). */
    url: string
    /* HTTP method bound to the rpc. */
    method: string
    /* Which surfaces advertise it (browser/mcp/cli), from the rpc's ClientFlags. */
    clients: Record<string, boolean>
    /* Argument-bag shape as JSON Schema; undefined when the rpc declares none. */
    inputSchema: Record<string, unknown> | undefined
    /* Success-body shape as JSON Schema; undefined when the rpc declares none. */
    outputSchema: Record<string, unknown> | undefined
    /* True when the rpc declares a filesSchema — it accepts multipart File parts. */
    files: boolean
    /* Per-rpc handler deadline in ms; undefined = no deadline. */
    timeout: number | undefined
    /* Per-rpc received-body cap in bytes; undefined = Bun's server-wide ceiling. */
    maxBodySize: number | undefined
    /* True when the rpc opts out of the same-origin CSRF gate. */
    crossOrigin: boolean | undefined
}
