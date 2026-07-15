import { SEEDS } from '../../shared/SEEDS.ts'

/* The async-cell warm-seed manifest: an SSR-resolved cell value, keyed by the cell's
   serialization-stable render-path id (`${scope.id}:${index}`), as a ref-json-encoded STRING
   (decoded lazily at the read site in `createAsyncCell`, so an in-process graph with cycles /
   shared back-references survives where JSON would drop it — the same codec `RESUME` uses).
   `startClient` drains `__SSR__.cells` into here before mount; a hydrating cell reads its key to
   seed its value warm instead of re-running the seed (no refetch, no pending flash).

   The `cells` partition of the one `__abideSeeds` manifest (ADR-0048, see SEEDS). */
// @documentation plumbing
export const CELL_SEED: Record<string, string> = SEEDS.cells
