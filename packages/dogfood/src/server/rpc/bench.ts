import { GET } from 'abide/server'
import type { BenchRow } from 'harness/rows'
import { harnessCatalog, harnessRows } from '#server/harnessRows'
import { onlyLoopback } from '#server/onlyLoopback'

// The browser alone: a model or a terminal has `bun run bench:*` already.
const LOCAL = {
    middleware: [onlyLoopback],
    clients: { ui: true, mcp: false, cli: false, openapi: false },
}

export const benchCatalog = GET(() => harnessCatalog('benchRows.ts'), LOCAL)

// Read by the page through `raw`, row by row — see `#ui/readRows`.
export const runBench = GET(
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
    { ...LOCAL, timeout: 255_000 },
)
