import { cookies, GET } from 'abide/server'

/**
 * An ordinary `Map`, and that is the decision worth stating: `bag()` and `trace().state` are the same
 * shape, so a third spelling for "a store that lives as long as this request" would be a third thing
 * to remember for no capability at all.
 *
 * Which means the whole `Map` surface is here — `has` before `get` for a cookie whose ABSENCE differs
 * from its being empty, `size` for "did this caller send anything at all", and iteration for a handler
 * that forwards them on.
 *
 * Parsed on the FIRST ask rather than on every request, so a route that never reads one pays nothing
 * for the header being there.
 */
export const whatArrived = GET(() => {
    const jar = cookies()
    return {
        theme: jar.get('theme') ?? 'light',
        // `has`, not `get(…) !== undefined`: a cookie set to the empty string was SENT, and a caller
        // that sent one is telling you something a caller that sent none is not.
        chosen: jar.has('theme'),
        sent: jar.size,
        names: [...jar.keys()],
    }
})
