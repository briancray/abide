import { CELL_SEED } from './CELL_SEED.ts'
import { DOC_SEED } from './DOC_SEED.ts'
import { warmSeedBackup } from './warmSeedBackup.ts'

/*
Re-populate the async-cell and doc-state warm-seed manifests from the pristine SSR copies stashed at
boot, undoing the consume-once deletes the failed hydration pass made. The router's hydration-desync
recovery calls this before it rebuilds the page COLD: with the seeds restored, each rebuilt cell
re-adopts its SSR-resolved value (reads settled, not pending) instead of refetching — so a blocking
`await` cell can't throw an uncaught SuspenseSignal at mount, and the cold render shows real data with
no loading flash. A no-op when boot never seeded (a fresh client-only mount).
*/
export function restoreWarmSeeds(): void {
    if (warmSeedBackup.cells !== undefined) {
        Object.assign(CELL_SEED, warmSeedBackup.cells)
    }
    if (warmSeedBackup.docs !== undefined) {
        Object.assign(DOC_SEED, warmSeedBackup.docs)
    }
}
