import { DELETE } from 'abide/server'

/** Removed rather than amended here, so the second press answers `gone` about something already gone. */
let stored: { id: number; name: string; role: string } | null = { id: 1, name: 'ada', role: 'author' }

/**
 * The last of the four, and the one the method is load-bearing for. A read falls back to a POST body
 * when its arguments outgrow a URL; a mutation accepts ONLY its own method, which is what makes a
 * `DELETE` unreachable by a link somebody was tricked into following.
 *
 * Its argument is the key alone, because a removal has nothing else to say.
 */
export const remove = DELETE(async ({ id }: { id: number }) => {
    if (stored?.id !== id) return { id, gone: false }
    stored = null
    return { id, gone: true }
})
