// One declaration, both sides. Both import THIS file by this name; what differs is what the lane
// loads — the module here, or a stub carrying nothing but the address.
//
// It is an endpoint because of WHERE IT IS, and it is addressed by the same fact: `users/getUser`.

import { GET, POST, server } from 'abide/server'
import { findUser, renameUser } from '../db.ts'

export const getUser = GET(({ id }: { id: number }) => findUser(id))

export const slowUser = GET(async ({ id }: { id: number }) => {
    await Bun.sleep(1)
    return findUser(id)
})

/** A handler that YIELDS. The compiler reads that off the syntax, so the stub knows to stream. */
export const countdown = GET(async function* ({ from }: { from: number }) {
    for (let n = from; n > 0; n--) yield n
})

export const rename = POST(({ id, name }: { id: number; name: string }) => renameUser(id, name))

/**
 * The one thing a handler cannot be handed: `fetch(request, self)` is two layers above this file, and
 * nothing between them has any other reason to know a server exists.
 */
export const listening = GET(() => ({ origin: server().url.origin }))
