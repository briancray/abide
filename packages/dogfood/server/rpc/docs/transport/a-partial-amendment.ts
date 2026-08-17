import { PATCH } from 'abide/server'

/** This rung's own copy of the record, so pressing its button says nothing about the one beside it. */
let stored = { id: 1, name: 'ada', role: 'author' }

/**
 * The same declaration again with the method changed again, and the argument is where `PATCH` parts
 * company with `PUT`: what it does not name it leaves ALONE, so every field but the key is optional and
 * the handler merges rather than assigns.
 *
 * A schema is DERIVED from that argument type, so the optionality is enforced at the door without being
 * written twice.
 */
export const amend = PATCH(async (changes: { id: number; name?: string; role?: string }) => {
    stored = { ...stored, ...changes }
    return stored
})
