import { GET } from 'abide/server'

/**
 * On the client this IS a keyed memo: `user({ id: 1 })` selects the slot and reading it is the request.
 * So three concurrent readers of one key cost ONE request, and the transport did nothing to arrange it.
 *
 * The body never reaches a browser — a module under `server/` is elided to its address in that lane.
 */
export const user = GET(async ({ id }: { id: number }) => {
    return { id, name: `user ${id}` }
})
