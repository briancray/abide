import { GET } from '@abide/abide/server'
import type { TestRow } from 'harness/rows'
import { harnessRows } from './server/harnessRows.ts'
import { localOnly } from './server/localOnly.ts'

/** Read by the page through `raw`, row by row — see `#src/instruments/lib/readRows`. */
export default GET(
    async function* ({
        scope,
        filter,
        gates,
    }: {
        scope: string
        filter: string
        // A URL's text where no args schema coerces it (19.7), so `false` arrives as `'false'`.
        gates: boolean | string
    }) {
        if (scope === '') return
        yield* harnessRows<TestRow>('testRows.ts', [
            '--scope',
            scope,
            '--filter',
            filter,
            ...(gates === true || gates === 'true' ? ['--gates'] : []),
        ])
    },
    // Per chunk, and the ceiling bun allows an idle socket: a browser spec is one quiet stretch.
    { ...localOnly(), timeout: 255_000 },
)
