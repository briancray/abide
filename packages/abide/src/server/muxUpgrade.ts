// 18.1, 37.3 — THE MUX'S UPGRADE, both halves of it: the app lane admitting it, and a listener — `App.listen`,
// or `abide dev`'s worker telling its listener — reading that admission off the lane's answer and
// performing it.
//
// THE ADMISSION IS A STATUS, NOT AN IDENTITY: a rung runs around the lane (37.3) and one that rebuilds
// the answer to lay a header over it has still let the lane answer. So the listener asks the one
// question the lane did, of the request as it arrived, and upgrades only where the answer still
// carries the status the lane admits with — a rung answering in the lane's place answers something
// else, and one answering an upgrade at any other address opens nothing.

import { SOCKET_ADDRESS } from '#shared/ADDRESSES.ts'
import { unmounted } from '#shared/mount.ts'

import { positiveSetting } from './config.ts'
import { plainAnswer } from './plainAnswer.ts'

const MUX_ADMITTED = 204

// What the mux carries: an app with no handler has no mux to open.
type Carried = { handlers: { size: number } }

/** Whether `request` is the mux's upgrade, at `pathname` below the mount. */
function asksForMux(
    pathname: string,
    request: Request,
    carried: Carried,
): boolean {
    return (
        pathname === SOCKET_ADDRESS &&
        request.headers.get('upgrade') === 'websocket' &&
        carried.handlers.size > 0
    )
}

/**
 * The app lane's answer to the mux's upgrade, or `undefined` where `request` is not one.
 *
 * 37.3 — arriving at the lane is the app's middleware having let the upgrade through.
 */
export function muxAdmission(
    asked: string,
    request: Request,
    carried: Carried,
): Response | undefined {
    return asksForMux(asked, request, carried)
        ? new Response(null, { status: MUX_ADMITTED })
        : undefined
}

/**
 * Whether the request is upgraded to the socket mux, given what the app lane answered it.
 *
 * 16.10 — read below the mount, as every other request's address is.
 */
export function admitsMux(
    request: Request,
    answered: Response,
    carried: Carried,
): boolean {
    if (answered.status !== MUX_ADMITTED) return false
    const pathname = new URL(request.url).pathname
    return asksForMux(unmounted(pathname) ?? pathname, request, carried)
}

/** The upgrade performed, carrying `data`: nothing to answer, or the refusal of a request that was no websocket. */
export function upgraded<Data>(
    server: { upgrade(request: Request, options: { data: Data }): boolean },
    request: Request,
    data: Data,
): Response | undefined {
    return server.upgrade(request, { data })
        ? undefined
        : plainAnswer('expected a websocket', 400)
}

/**
 * The limits a listener holds every connection to the mux to, `App.listen`'s and `abide dev`'s alike —
 * read off the resolved configuration, which `abide dev`'s worker reports to its listener.
 *
 * 18.28 — A FRAME IN past `ABIDE_MAX_SOCKET_MESSAGE_SIZE`, a mebibyte unless set: a frame names an
 * address and its args, which a `GET` carries in its URL. 18.29 — A CONNECTION IDLE is pinged, and
 * closed where two minutes pass with nothing back. 18.30 — WHAT IS SENT is buffered to bun's 16 MiB,
 * past which `send` drops it and the mux closes the peer (`SocketPeer`).
 */
export function muxSocketOptions(): {
    maxPayloadLength: number
    idleTimeout: number
    sendPings: boolean
    backpressureLimit: number
} {
    return {
        maxPayloadLength: positiveSetting(
            'ABIDE_MAX_SOCKET_MESSAGE_SIZE',
            1024 * 1024,
        ),
        idleTimeout: 120,
        sendPings: true,
        backpressureLimit: 16 * 1024 * 1024,
    }
}

/**
 * Sends `text` to `socket`, and closes it where bun dropped the frame rather than sending or buffering it.
 *
 * 18.30 — A FOLLOWER THAT MISSED A FRAME stands at a version the next one does not build on, so the
 * peer is closed rather than written past: the browser reconnects naming the version it holds (18.9)
 * and is sent what stands. No buffer of our own — what bun buffers is the bound.
 */
export function sendOrClose(
    socket:
        | {
              send(text: string): unknown
              close(code: number, reason: string): unknown
          }
        | undefined,
    text: string,
): void {
    if (socket?.send(text) === 0)
        socket.close(1013, 'the connection fell behind')
}
