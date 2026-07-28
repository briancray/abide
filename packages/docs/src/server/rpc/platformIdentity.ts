// #demo platformIdentity
import { GET } from 'abide/server/GET'
import { identity } from 'abide/shared/identity'

// Read the current request principal. `identity()` is ISOMORPHIC — this same import and call answers
// in a component too, where it returns the principal the SERVER resolved for the page (seeded at
// hydration, reactive, refreshed with `identity.refresh()`). It is never null on either side: the
// framework resolves an anonymous principal by default (via the bearer/cookie ladder) and a sealed
// authenticated one once `identity.set()` has run and the rolling `abide-identity` cookie rides
// subsequent requests. Only the WRITES are server-side — a browser cannot seal a cookie, so
// `identity.set()` there throws and names the mutation to call instead.
export default GET(() => {
    const principal = identity()
    return {
        id: principal.id,
        authenticated: principal.authenticated,
        name: typeof principal.name === 'string' ? principal.name : null,
    }
})
// #enddemo
