import { createResolverSlot } from './createResolverSlot.ts'
import type { DocSnapshots } from './types/DocSnapshots.ts'

/*
The active doc-snapshot slot — mirrors `resolvedCellsSlot`. The server entry installs an ALS-backed
resolver (a fresh list per request, so concurrent SSR renders never mix their doc seeds); with no
resolver registered a single fallback list is created lazily so isolated tests work without booting
the runtime. `createScope` pushes a `{ id, take }` for each rendered scope server-side; the page
renderer reads it at render-return to stamp `__SSR__.docs`.
*/
export const docSnapshotsSlot = createResolverSlot<DocSnapshots>(() => ({
    entries: [],
}))
