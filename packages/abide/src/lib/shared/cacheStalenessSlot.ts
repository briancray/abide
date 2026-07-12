import { applyCacheStalenessLocally } from './applyCacheStalenessLocally.ts'
import { createResolverSlot } from './createResolverSlot.ts'
import type { CacheStalenessApply } from './types/CacheStalenessApply.ts'

/*
The one side-swap seam for the isomorphic staleness verbs (ADR-0041), mirroring
cacheStoreSlot exactly. `invalidate()` and `refresh()` route through this after their
async-cell short-circuit, so their sources stay byte-identical on both sides — the
resolver decides the side:

  - client entry (startClient): installs applyCacheStalenessLocally — drop/refetch
    this tab's cache.
  - server entry (serverEntry): installs a broadcaster — serialize the selector and
    publish it to every connected client over the reserved __abide/cache socket.

With no resolver registered the fallback is applyCacheStalenessLocally too, so
isolated unit tests keep today's local behaviour without booting a runtime.
*/
export const cacheStalenessSlot = createResolverSlot<CacheStalenessApply>(
    () => applyCacheStalenessLocally,
)
