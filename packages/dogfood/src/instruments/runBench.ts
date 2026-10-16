import { GET } from '@abide/abide/server'
import type { BenchRow } from '@abide/harness/rows'
import { harnessRows } from './server/harnessRows.ts'
import { localOnly } from './server/localOnly.ts'

/** Read by the page through `raw`, row by row — see `#src/instruments/lib/readRows`. */
export default GET(
    async function* ({ scope, filter }: { scope: string; filter: string }) {
        if (scope === '') return
        yield* harnessRows<BenchRow>('benchRows.ts', [
            '--scope',
            scope,
            '--filter',
            filter,
        ])
    },
    // Per chunk, and the ceiling bun allows an idle socket: a 1000-card render is one quiet stretch.
    { ...localOnly(), timeout: 255_000 },
)
