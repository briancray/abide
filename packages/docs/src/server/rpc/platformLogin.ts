// #demo platformLogin

import { POST } from 'abide/server/POST'
import { identity } from 'abide/shared/identity'

// A login mutation: `identity.set()` promotes the request principal to authenticated and marks the
// scope so the router seals a rolling `abide-identity` cookie onto the response. The next request
// from this browser carries that cookie, so `platformIdentity` then reads back an authenticated
// principal — the page reflects the logged-in state.
export default POST(({ name = 'anonymous' }) => {
    identity.set({ name })
    const principal = identity()
    return {
        id: principal.id,
        authenticated: principal.authenticated,
        name: typeof principal.name === 'string' ? principal.name : null,
    }
})
// #enddemo
