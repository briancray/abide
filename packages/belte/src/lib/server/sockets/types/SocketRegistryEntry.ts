import type { ClientFlags } from '../../../shared/types/ClientFlags.ts'
import type { StandardSchemaV1 } from '../../rpc/types/StandardSchemaV1.ts'
import type { Socket } from './Socket.ts'

/*
Per-socket registry record. The Socket itself stays uniform between
server and client by parking policy state (history snapshot, client
publish gate, payload schema, client targeting) here instead of leaking
into the public Socket shape.
*/
export type SocketRegistryEntry = {
    socket: Socket<unknown>
    allowClientPublish: boolean
    schema: StandardSchemaV1 | undefined
    jsonSchema: Record<string, unknown> | undefined
    clients: ClientFlags
    snapshotHistory(): unknown[]
}
