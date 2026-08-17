import { GET } from 'abide/server'

/**
 * `description` is the human line, carried onto every generated surface — the schema document, the
 * stub, the tooling. It is written once and it is not a comment, because a comment reaches nobody
 * downstream.
 *
 * `schemas` is the declared shape in each direction, enforced at EVERY door: an in-process call, a
 * fetch, a websocket frame. When nothing is declared it is DERIVED from the handler's type, which is
 * why every rung above this one has a schema without writing one — this is how you override that, not
 * how you turn it on.
 *
 * The zero-dependency form is the one below: return what you accept, throw what you refuse. It
 * NORMALISES as well as refuses, since the handler is handed back whatever this returned.
 *
 * All of it is SERVER-SIDE TEXT. A module under `server/` is elided to its address in the browser
 * lane, so none of this ships.
 */
const aLookup = (value: unknown): { id: number } => {
    const { id } = value as { id?: unknown }
    if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error('id must be an integer')
    return { id }
}

export const user = GET(async ({ id }: { id: number }) => ({ id, name: `user ${id}` }), {
    description: 'One user by id.',
    schemas: { input: aLookup },
})
