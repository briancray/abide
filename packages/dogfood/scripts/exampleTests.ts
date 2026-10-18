// ONE CHAPTER APP'S TESTS, AS ROWS: `bun packages/dogfood/scripts/exampleTests.ts crm-01 --scope all`.
// Each file runs from the app's own directory, under the app's own `bunfig.toml`, as it does for a
// reader who downloaded it.

import { testRows } from '@abide/harness/runner'

const app = process.argv[2] ?? ''

await testRows(
    [
        {
            section: app,
            root: 'src',
            runner: 'bun',
            pattern: '**/*.test.ts',
        },
    ],
    Bun.fileURLToPath(new URL(`../examples/${app}`, import.meta.url)),
)
