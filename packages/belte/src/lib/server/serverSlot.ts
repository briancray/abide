import type { Server } from 'bun'

/*
Internal holder for the active Bun.serve instance. setActiveServer is
called once from createServer after Bun.serve resolves; the public
`server` import reads through this slot and throws when accessed before
init completes. `Server<unknown>` matches Bun's generic — ws.data is
opaque to user code since the only ws path is the framework-managed
rpc dispatcher.
*/
let active: Server<unknown> | undefined

export function setActiveServer(server: Server<unknown>): void {
    active = server
}

export function getActiveServer(): Server<unknown> | undefined {
    return active
}
