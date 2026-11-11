// Which callable shape this engine likes. Reports; asserts nothing, and at full size only under
// `bun run bench` — `BENCH_SIZING`.

import { test } from '@playwright/test'

import { buildBench } from '../bench/buildBench.ts'
import { BENCH_SIZING } from './BENCH_SIZING.ts'

const built = await buildBench('shapes')

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
