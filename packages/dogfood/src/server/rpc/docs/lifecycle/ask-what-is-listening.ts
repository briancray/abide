import { GET, server } from 'abide/server'

/**
 * The socket the boot bound, asked for from anywhere it is serving.
 *
 * Bun hands the `Server` to `fetch(request, self)` and nowhere else, so a module wanting `requestIP` or
 * `publish` would otherwise take it as a parameter through every frame between the entry point and
 * itself. That is the ceremony `request()` removes, and this is the same answer for a PROCESS fact
 * rather than a caller's: ask.
 *
 * `server.peek()` is the observing half, for a caller that may run before anything served — it hands
 * back `null` and never throws, where `server()` refuses rather than guessing.
 */
export const listening = GET(() => ({
    origin: server().url.origin,
    port: server().port,
    serving: server.peek() !== null,
}))

/**
 * A failure on a path nobody planned, so that the `onError` rung has a real one to point at.
 *
 * Left to fly. What a caller gets back is whatever this app's `onError` decided, which for a
 * `RangeError` is a 400 with a sentence on it rather than the 500 abide would otherwise send.
 */
export const outOfRange = GET(({ n }: { n: number }) => {
    if (n > 10) throw new RangeError(`n is at most 10, and this one is ${n}`)
    return { n }
})
