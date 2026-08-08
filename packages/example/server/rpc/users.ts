// One declaration, both sides. Both import THIS file by this name; what differs is what the lane
// loads — the module here, or a stub carrying nothing but the address.
//
// It is an endpoint because of WHERE IT IS, and it is addressed by the same fact: `users/getUser`.

import { error, GET, POST, server } from 'abide/server'
import { findUser, renameUser, type User } from '../db.ts'

/**
 * A failure declared ONCE, with a shape on it — the same declaration both sides read.
 *
 * The schema is the zero-ceremony form again (return what you accept, throw what you refuse), and it
 * is what types the data: `noSuchUser({ id })` is checked here, and a caller that asks
 * `getUser({ id }).isError(caught, 'NoSuchUser')` gets `caught.data.id` back with a type on it. Like
 * every other option in this file it is SERVER-SIDE TEXT — the browser lane gets the address alone.
 */
const noSuchUser = error.typed('NoSuchUser', 404, 'no user with that id', {
    schema: (value: unknown) => {
        const { id } = value as { id?: unknown }
        if (typeof id !== 'number') throw new Error('id must be a number')
        return { id }
    },
})

/**
 * `return`, not `throw`, and that is the whole of what a caller gains: a thrown failure is erased
 * from this function's type, and a returned one is in it — so `Rpc` carries `NoSuchUser` alongside
 * `User` and the browser narrows to the shape without either side restating it.
 */
export const getUser = GET(({ id }: { id: number }) => {
    if (id <= 0) return noSuchUser({ id }, `no user ${id}`)
    return findUser(id)
})

export const slowUser = GET(async ({ id }: { id: number }) => {
    await Bun.sleep(1)
    return findUser(id)
})

/** A handler that YIELDS. The compiler reads that off the syntax, so the stub knows to stream. */
export const countdown = GET(async function* ({ from }: { from: number }) {
    for (let n = from; n > 0; n--) yield n
})

/**
 * A declared shape, as the zero-dependency form: return what you accept, throw what you refuse.
 *
 * It normalises as well as refuses — the handler is handed what this returned — and like every other
 * option it is SERVER-SIDE TEXT: the browser lane gets the address and none of this.
 */
const aRename = (value: unknown): { id: number; name: string } => {
    const { id, name } = value as { id?: unknown; name?: unknown }
    if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error('id must be an integer')
    if (typeof name !== 'string' || name.trim() === '') throw new Error('name must not be blank')
    return { id, name: name.trim() }
}

/**
 * A create form: the record without the fields the server assigns.
 *
 * `Omit` is a COMPUTED type — no amount of text resolves it, because resolving it is what a checker
 * does. So the token pass publishes nothing for this endpoint and `abide/compiler/shapes` fills it
 * in: the one declaration here whose shape needs the second speed.
 */
export const add = POST((args: Omit<User, 'id' | 'connections'>) => ({ ...args, id: 99, connections: 1 }))

export const rename = POST(({ id, name }: { id: number; name: string }) => renameUser(id, name), {
    schemas: { input: aRename },
})

/**
 * The one thing a handler cannot be handed: `fetch(request, self)` is two layers above this file, and
 * nothing between them has any other reason to know a server exists.
 */
export const listening = GET(() => ({ origin: server().url.origin }))

/**
 * A file is an ARGUMENT, not a second calling convention.
 *
 * `File` in the type is the whole declaration: the client sends multipart because the args held
 * something JSON cannot carry, the server puts it back where it was, and the published shape says
 * `format: 'binary'` — which is what an OpenAPI document and an MCP tool definition both read.
 */
export const setAvatar = POST(async ({ id, avatar }: { id: number; avatar: File }) => ({
    id,
    name: avatar.name,
    bytes: (await avatar.arrayBuffer()).byteLength,
}))
