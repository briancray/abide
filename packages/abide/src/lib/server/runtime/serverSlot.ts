import type { Server } from 'bun'

/*
Internal holder for the active Bun.serve instance. setActiveServer is
called once from createServer after Bun.serve resolves; the public
`server()` function and any internal callers read through this slot
and throw when accessed before init completes. `Server<unknown>` matches
Bun's generic — ws.data is opaque to user code since the only ws path
is the framework-managed sockets dispatcher.
*/
export const serverSlot: { active: Server<unknown> | undefined } = {
    active: undefined,
}
