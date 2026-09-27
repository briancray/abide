import { GET } from 'abide/server'
import type { TestRow } from 'harness/rows'
import { harnessCatalog, harnessRows } from '#server/harnessRows'
import { onlyLoopback } from '#server/onlyLoopback'

// The browser alone: a model or a terminal has `bun run test` already.
const LOCAL = {
    middleware: [onlyLoopback],
    clients: { ui: true, mcp: false, cli: false, openapi: false },
}

export const testCatalog = GET(() => harnessCatalog('testRows.ts'), LOCAL)

// Read by the page through `raw`, row by row — see `#ui/readRows`.
export const runTests = GET(
    async function* ({
        scope,
        filter,
        gates,
    }: {
        scope: string
        filter: string
        // A URL's text where no args schema coerces it (19.8), so `false` arrives as `'false'`.
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
    { ...LOCAL, timeout: 255_000 },
)
