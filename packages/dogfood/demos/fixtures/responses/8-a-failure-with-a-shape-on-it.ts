import { error, GET, HttpError } from 'abide/server'

/**
 * `error(status)` two rungs up carries a phrase, which is all a caller can print. This carries DATA,
 * and the difference is what the caller can do rather than what the server said.
 *
 * `error.typed` declares the failure ONCE — a name, a status, a phrase and a schema — and the schema
 * is what types the data at both ends: `noSuchItem({ id })` is checked here, and a caller asking
 * `isError(caught, 'NoSuchItem')` gets `caught.data.id` back with a type on it.
 *
 * RETURNED, not thrown, and that is the whole of what a caller gains: a thrown failure is erased from
 * this handler's type and a returned one is in it, so the declaration travels to the other side
 * without either party restating it. A `throw` refuses identically and only loses the naming.
 */
const noSuchItem = error.typed('NoSuchItem', 404, 'no item with that id', {
    schema: (value: unknown) => {
        const { id } = value as { id?: unknown }
        if (typeof id !== 'number') throw new Error('id must be a number')
        return { id }
    },
})

export const item = GET(({ id }: { id: number }) => {
    if (id < 1) return noSuchItem({ id })
    return { id, name: `item ${id}` }
})

/**
 * The same four members in-process and over a wire, which is why what a caller catches is checked
 * STRUCTURALLY rather than with an `instanceof` against a class it imported: on the far side of a
 * fetch there is no class, only the shape that was sent.
 */
export function describe(caught: unknown): string {
    if (!(caught instanceof HttpError)) return 'not ours'
    return `${caught.name} ${caught.status}: ${caught.message}`
}
