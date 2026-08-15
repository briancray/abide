import { POST } from 'abide/server'

/**
 * The second law's write half. Same declaration as a `GET`, and the difference is what it RETAINS:
 * a read is a keyed memo and caches; a mutation keeps nothing, so calling it twice runs it twice.
 */
export const rename = POST(async ({ id, name }: { id: number; name: string }) => {
    return { id, name }
})
