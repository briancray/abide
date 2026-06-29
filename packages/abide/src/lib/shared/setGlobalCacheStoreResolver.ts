import { globalCacheStoreResolver } from './globalCacheStoreResolver.ts'

// Registers the process-level cache store resolver. Called once per side at boot.
export const setGlobalCacheStoreResolver = globalCacheStoreResolver.set
