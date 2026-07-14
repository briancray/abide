import { createResolverSlot } from './createResolverSlot.ts'
import type { CacheReaderHook } from './types/CacheReaderHook.ts'

/*
Client-only seam for the reactive-reader lifecycle (ADR-0043). No fallback: unresolved,
get() is undefined and the store's engage/disengage calls are inert — so the server's
request store and isolated unit tests do nothing. The client entry (startClient) installs
a hook that opens a per-key amend value subscription on a key's first reader and closes it
on its last, keeping the subscription set congruent with what this tab is reading.
*/
export const cacheReaderSocketSlot = createResolverSlot<CacheReaderHook>()
