// EVERY TEST FILE IN THE REPO, AS ROWS — what the docs app's tests page lists and runs.
// `bun packages/dogfood/scripts/testRows.ts --list`, or `--scope all --filter reactive`, from the
// repo root. The runner is the harness's; the suites are this repo's.

import { testRows } from '@abide/harness/runner'

await testRows(
    [
        { section: 'abide', root: 'packages/abide/tests', runner: 'bun' },
        { section: 'harness', root: 'packages/harness/tests', runner: 'bun' },
        { section: 'dogfood', root: 'packages/dogfood/tests', runner: 'bun' },
        {
            section: 'browser · docs app',
            root: 'packages/dogfood/e2e',
            runner: 'playwright',
            projects: ['root', 'sub-path'],
        },
        {
            section: 'browser · docs cards',
            root: 'packages/dogfood/src',
            runner: 'playwright',
            projects: ['cards'],
            pattern: '**/tests/*.e2e.ts',
        },
        {
            section: 'browser · abide',
            root: 'packages/abide/e2e',
            runner: 'playwright',
            projects: ['abide', 'abide-webkit'],
        },
        {
            section: 'browser · harness',
            root: 'packages/harness/e2e',
            runner: 'playwright',
            projects: ['harness', 'harness-webkit'],
        },
    ],
    Bun.fileURLToPath(new URL('../../../', import.meta.url)),
)
