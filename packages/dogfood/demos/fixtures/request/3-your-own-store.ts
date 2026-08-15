import { bag, cookies, GET } from 'abide/server'

/**
 * The same `Map`, yours to write — one per request, gone when it ends.
 *
 * What middleware resolved and a handler needs: the row behind a session, a feature flag decided
 * once. Not a module-level variable, which two concurrent requests would share, and not a parameter
 * threaded through every frame — which is the thing that makes people reach for the variable.
 */
export const catalogue = GET(() => {
    const theme = cookies().get('theme') ?? 'light'
    bag().set('theme', theme)
    return { theme: bag().get('theme') }
})
