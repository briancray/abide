// One declaration. Both sides import THIS file by this name; what differs is what the lane loads.
// It is an endpoint because of where it is — `server/rpc/` — and it is addressed by the same fact:
// `users/getUser`.

import { findUser } from '../../db.ts'
import { GET } from '../../rpc.ts'

export const getUser = GET(({ id }: { id: number }) => findUser(id))

export const slowUser = GET(async ({ id }: { id: number }) => {
    await Bun.sleep(1)
    return findUser(id)
})
