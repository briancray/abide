import type { CacheStore } from './types/CacheStore.ts'

/*
Internal slot the runtime entries register their resolver into. The
server entry installs an ALS-backed resolver (request-scoped); the
client entry installs a module-singleton resolver. `fallback` is a
single lazy store used only when no resolver is registered — keeps
isolated tests working without forcing them to spin up the runtime.
*/
export const cacheStoreSlot: {
    resolver: (() => CacheStore | undefined) | undefined
    fallback: CacheStore | undefined
} = {
    resolver: undefined,
    fallback: undefined,
}
