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
 * What was thrown, as `onError` and any `catch` between here and it will see it.
 *
 * `HttpError` is the class, and the status rides ON it — so a refusal that crosses four frames is
 * still a 400 when it arrives, rather than a 500 that lost its meaning on the way out.
 */
export function statusOf(thrown: unknown): number {
    return thrown instanceof HttpError ? thrown.status : 500
}
