// The server that is listening, reachable from anything it is serving.
//
// Bun hands the `Server` to `fetch(request, self)` and to nowhere else — there is no `Bun.server` to
// ask — so a module that wants `requestIP`, `publish` or `pendingWebSockets` has to be handed it, one
// parameter at a time, through every layer between the entry point and itself. That is the same
// ceremony `request()` exists to remove, and the answer is the same shape: ask.
//
// The hand-over is one assignment, and `dispatch` already makes it — it takes the server for the
// socket upgrade, and latches it BEFORE the prefix test, so an app that mounted it in front of its own
// routes has already wired this by writing `dispatch(request, self)`. An app that mounts nothing says
// so once: `server.set(Bun.serve({ … }))`.
//
// A PROCESS fact, not a per-request one — the same kind of question `appDataDir()` answers, and it
// does not differ between two callers. Two `Bun.serve` calls in one process (a test wire beside the
// app) is the case that has no honest answer here, and it is why `dispatch` still TAKES the server for
// an upgrade rather than reading it back: the argument is exact, this is the fallback.

import type { Server } from 'bun'

let RUNNING: Server<never> | null = null

export interface RunningServer {
    /**
     * The server that is listening. Throws when nothing has served yet — there is no honest answer to
     * guess, exactly as with `request()`.
     *
     * The type parameter is the socket data the app attaches at upgrade, so a caller that reaches for
     * `upgrade` or a `ServerWebSocket` names its own shape instead of casting.
     */
    <WebSocketData = unknown>(): Server<WebSocketData>
    /** The server if there is one, and `null` before there is. Observes; never throws. */
    peek<WebSocketData = unknown>(): Server<WebSocketData> | null
    /** Hand it over. Returns what it was given, so `server.set(Bun.serve({ … }))` is the whole wiring. */
    set<WebSocketData>(instance: Server<WebSocketData>): Server<WebSocketData>
}

/**
 * The Bun server that is listening.
 *
 * A PROCESS fact, so it THROWS before anything has served rather than answering `undefined` — a
 * caller that reached for it too early has a bug, and a null it forgot to check is a worse one.
 */
export const server: RunningServer = (<WebSocketData>(): Server<WebSocketData> => {
    if (RUNNING === null) {
        throw new Error(
            'abide: server() was called before anything served — Bun hands the server to `fetch(request, self)` and nowhere else, so either mount `dispatch(request, self)` or hand it over with `server.set(Bun.serve({ … }))`',
        )
    }
    return RUNNING as Server<WebSocketData>
}) as RunningServer

server.peek = <WebSocketData>(): Server<WebSocketData> | null => RUNNING as Server<WebSocketData> | null

server.set = <WebSocketData>(instance: Server<WebSocketData>): Server<WebSocketData> => {
    RUNNING = instance as Server<never>
    return instance
}
