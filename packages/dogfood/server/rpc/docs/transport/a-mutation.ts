import { POST } from 'abide/server'

/**
 * How many times a handler that RETAINS NOTHING has run — the difference between the two laws, as a
 * number a browser can watch go up rather than a sentence under the example.
 */
let ran = 0

/**
 * The second law's write half. Same declaration as a `GET`, and the difference is what it RETAINS:
 * a read is a keyed memo and caches; a mutation keeps nothing, so calling it twice runs it twice.
 */
export const rename = POST(async ({ id, name }: { id: number; name: string }) => {
    return { id, name, ran: ++ran }
})
