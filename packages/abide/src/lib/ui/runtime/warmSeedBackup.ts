import type { SsrPayload } from '../../shared/types/SsrPayload.ts'

/* The pristine SSR warm-seed manifests (`__SSR__.cells` / `__SSR__.docs`), stashed by `startClient`
   before the hydration pass drains their client copies — each adopted seed is DELETED from CELL_SEED /
   consumed from DOC_SEED as it hydrates. `Object.assign`-ing into those seeds leaves these source
   records untouched, so they stay a clean re-seed source. The router's discard→cold-rebuild recovery
   reads them via `restoreWarmSeeds` so the rebuilt cells re-adopt the SSR-resolved values instead of
   refetching cold — a cold refetch would leave a blocking `await` cell pending and throw an uncaught
   SuspenseSignal at mount, killing the page. Empty on a fresh client-only mount (nothing seeded). */
export const warmSeedBackup: { cells?: SsrPayload['cells']; docs?: SsrPayload['docs'] } = {}
