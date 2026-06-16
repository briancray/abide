/*
One RPC verb projected for the inspector: the registry entry reduced to the
serializable facts the UI renders — where it mounts, its method, which
non-browser surfaces advertise it, and its argument/result shapes as JSON
Schema. Schemas project through jsonSchemaForSchema (same as MCP/OpenAPI), so
a verb whose library can't render a schema still lists with an opaque shape.
*/
export type InspectorVerb = {
    /* Registry key — the rpc URL the verb mounts at (e.g. /rpc/users/create). */
    url: string
    /* HTTP method bound to the verb. */
    method: string
    /* Which surfaces advertise it (browser/mcp/cli), from the verb's ClientFlags. */
    clients: Record<string, boolean>
    /* Argument-bag shape as JSON Schema; undefined when the verb declares none. */
    inputSchema: Record<string, unknown> | undefined
    /* Success-body shape as JSON Schema; undefined when the verb declares none. */
    outputSchema: Record<string, unknown> | undefined
    /* True when the verb declares a filesSchema — it accepts multipart File parts. */
    files: boolean
    /* Per-verb handler deadline in ms; undefined = no deadline. */
    timeout: number | undefined
    /* Per-verb received-body cap in bytes; undefined = Bun's server-wide ceiling. */
    maxBodySize: number | undefined
    /* True when the verb opts out of the same-origin CSRF gate. */
    crossOrigin: boolean | undefined
}
