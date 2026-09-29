// `sharedCases` in the reader's engine. Reports rather than asserts, like `reactive.spec.ts`.
import { execFileSync } from 'node:child_process'
import { test } from '@playwright/test'
import type { SharedRow } from '../scripts/sharedRun.ts'

const REPO = new URL('../../../', import.meta.url).pathname

const built = execFileSync(
    'bun',
    ['packages/harness/scripts/buildBench.ts', 'shared'],
    { cwd: REPO, encoding: 'utf8' },
).trim()

test('shared allocations, current against candidate, in this engine', async ({
    page,
}, testInfo) => {
    test.setTimeout(15 * 60 * 1000)
    await page.addInitScript({ path: built })
    await page.goto('about:blank')
    await page.setContent('<!doctype html><html><body></body></html>')
    const rows = (await page.evaluate(() =>
        (
            globalThis as unknown as {
                __SHARED_BENCH__: (budget: number) => SharedRow[]
            }
        ).__SHARED_BENCH__(60_000_000_000),
    )) as SharedRow[]
    const { formatShared } = await import('../scripts/sharedRun.ts')
    console.log(`\n=== ${testInfo.project.name} ===\n${formatShared(rows)}`)
})
