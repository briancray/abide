// Which demo apps are actually up, asked from the one side that can tell.
//
// `/demos` frames applications served by OTHER processes behind the front door. Under `bun run dev`
// this app is alone on the origin and every frame lands on a 404 — which renders as an empty box, and
// an empty box is indistinguishable from a demo that is broken, or slow, or was never built.
//
// The check has to be an endpoint rather than a page module, and that is not a style choice: a page
// module runs in BOTH lanes, and a browser asking `http://localhost:4402` is a cross-origin request
// that fails whether or not the app is running. It would report every demo down, most confidently
// when they were all up. Here, it is a `fetch` from one server to another on the same machine.
//
// Asked of the app's OWN port rather than of the door, deliberately. The door being up says nothing
// about the app behind it, and the failure this exists to describe — "you are running `bun run dev`"
// — is exactly the one where the door is absent too.

import { GET } from 'abide/server'
import { APPS } from '#shared/demos/APPS.ts'

/** Short: the answer is "is a local process listening", and a slow one is a no for this purpose. */
const WAITING_MS = 400

/**
 * One entry per app in the fleet, in `APPS` order.
 *
 * A record rather than a list of the ones that are up, so the page can say WHICH is missing rather
 * than only that something is.
 */
export const fleetStatus = GET(async (): Promise<{ up: Record<string, boolean> }> => {
    const up: Record<string, boolean> = {}
    await Promise.all(
        APPS.map(async (app) => {
            try {
                const answered = await fetch(`http://localhost:${app.port}${app.prefix}${app.entry}`, {
                    signal: AbortSignal.timeout(WAITING_MS),
                })
                // Read to completion so the socket is not left half-open on a server this one has to
                // keep talking to. `cancel` rather than `text` — nothing here wants the bytes.
                await answered.body?.cancel()
                up[app.name] = answered.ok
            } catch {
                // Refused, timed out, or nothing there. All of them mean the same thing to a reader.
                up[app.name] = false
            }
        }),
    )
    return { up }
})
