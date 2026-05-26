import type { Socket } from './Socket.ts'

/*
Per-socket registry record. The Socket itself stays uniform between
server and client by parking policy state (history snapshot, client
publish gate) here instead of leaking into the public Socket shape.
*/
export type SocketRegistryEntry = {
    socket: Socket<unknown>
    allowClientPublish: boolean
    snapshotHistory(): unknown[]
}
