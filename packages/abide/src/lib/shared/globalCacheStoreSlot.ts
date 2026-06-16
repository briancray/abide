import type { CacheStore } from './types/CacheStore.ts'

/*
Slot for the process-level cache store resolver used by cache() entries opting
into `global: true`. The server entry registers a module-singleton store that
outlives any one request; the client entry points it at its single tab store so
`global` is a no-op there. Unset means no global store is registered, in which
case globalCacheStore() falls back to the active (request/tab) store.
*/
export const globalCacheStoreSlot: {
    resolver: (() => CacheStore | undefined) | undefined
} = {
    resolver: undefined,
}
