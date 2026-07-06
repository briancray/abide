import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { Socket } from '../../../shared/types/Socket.ts'
import type { StandardSchemaV1 } from '../../../shared/types/StandardSchemaV1.ts'

/*
Per-socket registry record. The Socket itself stays uniform between
server and client by parking policy state (retained-tail snapshot, client
publish gate, payload schema, client targeting) here instead of leaking
into the public Socket shape.
*/
export type SocketRegistryEntry = {
    socket: Socket<unknown>
    allowClientPublish: boolean
    schema: StandardSchemaV1 | undefined
    clients: ClientFlags
    /* last `count` retained frames (whole tail when omitted) — the read-only
       face shared by the ws sub replay, the HTTP rest() face, and MCP tail */
    snapshotTail(count?: number): unknown[]
}
