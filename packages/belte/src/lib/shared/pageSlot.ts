import type { PageSnapshot } from './types/PageSnapshot.ts'

/*
Internal slot the runtime entries register their page resolver into. The
server entry installs an ALS-backed resolver (request-scoped, so concurrent
and streaming renders never share state); the client entry installs a
module-singleton resolver. `fallback` is a single lazy snapshot used only
when no resolver is registered — keeps isolated tests working without forcing
them to spin up the runtime. Mirrors cacheStoreSlot.
*/
export const pageSlot: {
    resolver: (() => PageSnapshot | undefined) | undefined
    fallback: PageSnapshot | undefined
} = {
    resolver: undefined,
    fallback: undefined,
}
