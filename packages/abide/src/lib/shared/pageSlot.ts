import { createResolverSlot } from './createResolverSlot.ts'
import type { PageSnapshot } from './types/PageSnapshot.ts'

/*
The active-page slot. The server entry installs an ALS-backed resolver
(request-scoped, so concurrent and streaming renders never share state); the
client entry a module-singleton one. With no resolver registered, a single
empty snapshot is created lazily so isolated tests work; test helpers
snapshot/poke `.resolver` and `.fallback` directly. activePage is the public
read.
*/
export const pageSlot = createResolverSlot<PageSnapshot>(() => ({
    route: '',
    params: {},
    url: new URL('http://localhost/'),
    navigating: false,
}))
