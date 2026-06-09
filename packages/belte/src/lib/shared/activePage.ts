import { pageSlot } from './pageSlot.ts'
import type { PageSnapshot } from './types/PageSnapshot.ts'

/*
Resolves the active page snapshot. The runtime is registered via
`setPageResolver` from the server entry (request-scoped via ALS) or the
client entry (module-level singleton). If no resolver is registered, a single
fallback snapshot is created lazily so isolated tests still work. Mirrors
activeCacheStore.
*/
export function activePage(): PageSnapshot {
    const fromResolver = pageSlot.resolver?.()
    if (fromResolver) {
        return fromResolver
    }
    if (!pageSlot.fallback) {
        pageSlot.fallback = {
            route: '',
            params: {},
            url: new URL('http://localhost/'),
            navigating: false,
        }
    }
    return pageSlot.fallback
}
