/*
One declared socket projected for the inspector: its name plus the operations
it exposes (tail always; publish only when it allows client publishing),
mirroring the CLI/MCP projection from socketOperations so the inspector can't
disagree with them about a socket's faces.
*/
export type InspectorSocket = {
    /* The socket's file-path name (may contain `/` for nested files). */
    name: string
    /* The operations exposed, named as the CLI/MCP advertise them. */
    operations: Array<{
        kind: string
        name: string
        method: string
        restUrl: string
    }>
}
