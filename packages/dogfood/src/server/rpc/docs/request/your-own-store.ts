import { bag, cookies, GET } from 'abide/server'

/**
 * The same `Map`, yours to write — one per request, gone when it ends.
 *
 * What middleware resolved and a handler needs: the row behind a session, a feature flag decided
 * once. Not a module-level variable, which two concurrent requests would share, and not a parameter
 * threaded through every frame — which is the thing that makes people reach for the variable.
 */
export const whatArrived = GET(() => {
    // Written on the way in and read back further down, which is the whole of what a bag is for. A
    // second request is a second Map, so `size` is 1 however many times this is called.
    bag().set('theme', cookies().get('theme') ?? 'light')
    return { theme: bag().get('theme'), held: bag().size }
})
