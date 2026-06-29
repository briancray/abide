import { createResolverSlot } from './createResolverSlot.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Slot + setter for the process-level cache store resolver used by cache() entries
opting into `global: true`. The server entry registers a module-singleton store
outliving any one request; the client entry points it at its single tab store so
`global` is a no-op there. No fallback creator — when unset, globalCacheStore()
falls through to the active store rather than minting an isolated one.
globalCacheStoreSlot / setGlobalCacheStoreResolver re-export the slot and setter.
*/
export const globalCacheStoreResolver = createResolverSlot<CacheStore>()
