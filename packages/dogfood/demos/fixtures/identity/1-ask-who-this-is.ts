import { identity } from 'abide'

/**
 * The same call on both sides, and always a promise — on a client it may have to ask.
 *
 * A principal is never null: anonymous IS an answer, so a reader never writes the `?? guest` half of
 * them forget.
 */
export async function greeting(): Promise<string> {
    const who = await identity()
    return who.authenticated ? `hello, ${who.name}` : 'hello, stranger'
}
