import { DELETE, PATCH, PUT } from 'abide/server'

/**
 * There is no fourth thing to learn. `PUT`, `PATCH` and `DELETE` take exactly what `POST` takes and
 * retain exactly what it retains — the method is the only difference, and it is the method the wire
 * carries so an ordinary HTTP client can call any of them.
 *
 * A read falls back to a POST body when its arguments outgrow a URL; a mutation accepts only its own
 * method, which is what makes `DELETE` unreachable by a link somebody was tricked into following.
 */
export const replace = PUT(async ({ id, name }: { id: number; name: string }) => ({ id, name }))

export const amend = PATCH(async ({ id, name }: { id: number; name?: string }) => ({ id, name }))

export const remove = DELETE(async ({ id }: { id: number }) => ({ id, gone: true }))
