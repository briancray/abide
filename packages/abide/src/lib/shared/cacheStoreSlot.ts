import { cacheStoreResolver } from './cacheStoreResolver.ts'

/*
Internal slot the runtime entries register their resolver into (see
cacheStoreResolver). Exposed so test helpers snapshot/poke `.resolver` and
`.fallback` directly.
*/
export const cacheStoreSlot = cacheStoreResolver.slot
