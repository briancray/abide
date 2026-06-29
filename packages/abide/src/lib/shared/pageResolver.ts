import { createResolverSlot } from './createResolverSlot.ts'
import type { PageSnapshot } from './types/PageSnapshot.ts'

/*
The active-page slot/resolver/reader bundle. The server entry installs an
ALS-backed resolver (request-scoped, so concurrent and streaming renders never
share state); the client entry a module-singleton one. With no resolver
registered, a single empty snapshot is created lazily so isolated tests work.
pageSlot / activePage re-export the slot and reader; setPageResolver the setter.
*/
export const pageResolver = createResolverSlot<PageSnapshot>(() => ({
    route: '',
    params: {},
    url: new URL('http://localhost/'),
    navigating: false,
}))
