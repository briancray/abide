import { PUT } from 'abide/server'

/** The record the three method rungs each write differently, so a full write can be told from a partial one. */
let stored = { id: 1, name: 'ada', role: 'author' }

/**
 * `PUT` takes exactly what `POST` takes and retains exactly what it retains — the method is the only
 * difference in the DECLARATION, and it is the method the wire carries, so an ordinary HTTP client can
 * call this one.
 *
 * What the method MEANS is in the argument: a replacement carries every field, so what it leaves out it
 * clears rather than leaves alone.
 */
export const replace = PUT(async (record: { id: number; name: string; role: string }) => {
    stored = record
    return stored
})
