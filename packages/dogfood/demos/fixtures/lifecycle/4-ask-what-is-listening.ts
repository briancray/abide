import { log } from 'abide'
import { server } from 'abide/server'

/**
 * The socket the hooks above bound, asked for from anywhere it is serving.
 *
 * Bun hands the `Server` to `fetch(request, self)` and nowhere else, so a module wanting `requestIP` or
 * `publish` would otherwise take it as a parameter through every frame between the entry point and
 * itself. That is the ceremony `request()` removes, and this is the same answer for a PROCESS fact
 * rather than a caller's: ask.
 */
export async function onStart(start: () => Promise<void>): Promise<void> {
    await start()
    // Inside `onStart`, AFTER `start()` — the onion is what makes this safe to ask. Above the await
    // there is no socket yet, and `server()` refuses rather than guessing.
    log(`listening on ${server().port}`)
}

/** The observing half, for a caller that may run before anything served. Returns `null`; never throws. */
export function isServing(): boolean {
    return server.peek() !== null
}
