import { cacheStoreResolver } from './cacheStoreResolver.ts'

// Registers the runtime's active-CacheStore resolver. Called once per side at boot.
export const setCacheStoreResolver = cacheStoreResolver.set
