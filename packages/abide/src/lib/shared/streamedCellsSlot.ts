import { createResolverSlot } from './createResolverSlot.ts'
import type { StreamedCells } from './types/StreamedCells.ts'

/*
The active streamed-cells slot — mirrors `resolvedCellsSlot`/`pendingAsyncCellsSlot`. The server
entry installs an ALS-backed resolver (a fresh list per request, so concurrent SSR renders never
mix their streamed values); with no resolver a single fallback list is created lazily so isolated
tests work without booting the runtime. `createAsyncCell` pushes a `{ key, promise }` when a
STREAMING cell constructs server-side; the page renderer drains it during the stream, awaiting each
promise and streaming an `__abideResolve({ cellKey, value })` chunk (ADR-0035).
*/
export const streamedCellsSlot = createResolverSlot<StreamedCells>(() => ({
    entries: [],
}))
