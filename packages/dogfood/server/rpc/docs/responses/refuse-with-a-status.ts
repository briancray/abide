import { error, GET, HttpError } from 'abide/server'

/**
 * A refusal, THROWN rather than returned — so it can come from anywhere under the handler without
 * every frame between having to pass it back up.
 *
 * `error(status)` is the untyped arm: a status and a phrase, which is all a caller can do anything
 * with. When a caller should NARROW the failure instead of reading a message, that is `error.typed`,
 * and it is a `return` rather than a throw — see the transport ladder.
 */
export const catalogue = GET(({ id }: { id: number }) => {
    if (id < 1) error(400, 'an id starts at 1')
    return { id }
})

/**
 * The same throw, CAUGHT — which is what `onError` and any `catch` between here and it sees.
 *
 * `HttpError` is the class, and the status rides ON it, so a refusal that crossed four frames is
 * still a 400 when it arrives rather than a 500 that lost its meaning on the way out.
 */
export const whatItWas = GET(({ id }: { id: number }) => {
    try {
        if (id < 1) error(400, 'an id starts at 1')
        return { status: 200, saying: 'accepted' }
    } catch (thrown) {
        if (thrown instanceof HttpError) return { status: thrown.status, saying: thrown.message }
        throw thrown
    }
})
