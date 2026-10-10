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
