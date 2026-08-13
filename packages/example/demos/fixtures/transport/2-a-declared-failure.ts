import { error, GET } from 'abide/server'

/** A DECLARED failure crosses the wire as itself, so a caller narrows it rather than parsing a message. */
const notFound = error.typed('NoSuchUser', 404, 'no user by that id', {
    schema: (value: unknown) => value as { id: number },
})

export const user = GET(async ({ id }: { id: number }) => {
    if (id < 1) return notFound({ id }, `no user ${id}`)
    return { id, name: `user ${id}` }
})
