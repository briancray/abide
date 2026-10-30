// Which callable shape this engine likes. Reports; asserts nothing, and at full size only under
// `bun run bench` — `BENCH_SIZING`.
import { execFileSync } from 'node:child_process'

import { test } from '@playwright/test'

import { BENCH_SIZING } from './BENCH_SIZING.ts'

const REPO = new URL('../../../', import.meta.url).pathname
const built = execFileSync(
    'bun',
    ['packages/abide/bench/buildBench.ts', 'shapes'],
    { cwd: REPO, encoding: 'utf8' },
).trim()

test('callable shapes in this engine', async ({ page }, testInfo) => {
    test.setTimeout(10 * 60 * 1000)
    await page.addInitScript({ path: built })
    await page.goto('about:blank')
    await page.setContent('<!doctype html><html><body></body></html>')
    const rows = (await page.evaluate(
        (sizing) =>
            (
                globalThis as unknown as {
                    __SHAPES__: (sizing?: typeof BENCH_SIZING) => unknown
                }
            ).__SHAPES__(sizing),
        BENCH_SIZING,
    )) as { shape: string; read: number; write: number }[]
    if (BENCH_SIZING) return
    const lines = [`\n=== ${testInfo.project.name} ===`]
    for (const row of rows)
        lines.push(
            `${row.shape.padEnd(10)} read ${row.read.toFixed(2)} ns   write ${row.write.toFixed(2)} ns`,
        )
    console.log(lines.join('\n'))
})
