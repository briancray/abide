import { createResolverSlot } from './createResolverSlot.ts'
import type { ResolvedCells } from './types/ResolvedCells.ts'

/*
The active resolved-async-cells slot — mirrors `pendingAsyncCellsSlot`. The server entry installs
an ALS-backed resolver (a fresh list per request, so concurrent SSR renders never mix their warm
seeds); with no resolver registered a single fallback list is created lazily so isolated tests
work without booting the runtime. `createAsyncCell` pushes a `{key, value}` when a seed settles
server-side; the page renderer reads it at render-return to stamp `__SSR__.cells`.
*/
export const resolvedCellsSlot = createResolverSlot<ResolvedCells>(() => ({
    entries: [],
}))
