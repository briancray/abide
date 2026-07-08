import { createResolverSlot } from './createResolverSlot.ts'
import type { PendingAsyncCells } from './types/PendingAsyncCells.ts'

/*
The active pending-async-cells slot — mirrors `cacheStoreSlot`. The server entry
installs an ALS-backed resolver (a fresh list per request, so concurrent SSR
renders never share the drain); with no resolver registered a single fallback
list is created lazily so isolated tests work without booting the runtime. Read
through `pendingAsyncCellsSlot.get()`; the SSR barrier (`settleAsyncCells`) drains it.
*/
export const pendingAsyncCellsSlot = createResolverSlot<PendingAsyncCells>(() => ({
    promises: [],
}))
