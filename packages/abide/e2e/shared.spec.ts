// `sharedCases` in the reader's engine. Reports rather than asserts, like `reactive.spec.ts`, and
// at full size only under `bun run bench` — `BENCH_SIZING`.

import { test } from '@playwright/test'

import { buildBench } from '../bench/buildBench.ts'
import type { SharedRow } from '../bench/sharedRun.ts'
import { BENCH_SIZING } from './BENCH_SIZING.ts'

const built = await buildBench('shared')

test('shared allocations, current against candidate, in this engine', async ({
    page,
}, testInfo) => {
    test.setTimeout(15 * 60 * 1000)
    await page.addInitScript({ path: built })
    await page.goto('about:blank')
    await page.setContent('<!doctype html><html><body></body></html>')
    const rows = (await page.evaluate(
        (sizing) =>
            (
                globalThis as unknown as {
                    __SHARED_BENCH__: (
                        budget: number,
                        sizing?: typeof BENCH_SIZING,
                    ) => SharedRow[]
                }
            ).__SHARED_BENCH__(60_000_000_000, sizing),
        BENCH_SIZING,
    )) as SharedRow[]
    if (BENCH_SIZING) return
    const { formatShared } = await import('../bench/sharedRun.ts')
    console.log(`\n=== ${testInfo.project.name} ===\n${formatShared(rows)}`)
})
