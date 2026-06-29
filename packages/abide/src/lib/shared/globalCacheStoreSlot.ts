import { globalCacheStoreResolver } from './globalCacheStoreResolver.ts'

/*
Slot for the process-level cache store resolver (see globalCacheStoreResolver).
Exposed so test helpers snapshot/poke `.resolver` directly. Unset means no global
store is registered, in which case globalCacheStore() falls back to the active
(request/tab) store.
*/
export const globalCacheStoreSlot = globalCacheStoreResolver.slot
