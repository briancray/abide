import { createResolverSlot } from './createResolverSlot.ts'
import type { CacheStore } from './types/CacheStore.ts'

/*
Slot for the process-level cache store used by cache() entries opting into
`global: true`. The server entry registers a module-singleton store outliving
any one request; the client entry points it at its single tab store so
`global` is a no-op there. No fallback creator — unset means no global store
is registered, in which case globalCacheStore() falls back to the active
(request/tab) store. Test helpers snapshot/poke `.resolver` directly.
*/
export const globalCacheStoreSlot = createResolverSlot<CacheStore>()
