// Which callable shape this engine likes. Reports; asserts nothing.
import { execFileSync } from 'node:child_process'
import { test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname
const built = execFileSync(
    'bun',
    ['packages/harness/scripts/buildBench.ts', 'shapes'],
    { cwd: REPO, encoding: 'utf8' },
).trim()

test('callable shapes in this engine', async ({ page }, testInfo) => {
    test.setTimeout(10 * 60 * 1000)
    await page.addInitScript({ path: built })
    await page.goto('about:blank')
    await page.setContent('<!doctype html><html><body></body></html>')
    const rows = (await page.evaluate(() =>
        (globalThis as unknown as { __SHAPES__: () => unknown }).__SHAPES__(),
    )) as { shape: string; read: number; write: number }[]
    const lines = [`\n=== ${testInfo.project.name} ===`]
    for (const row of rows)
        lines.push(
            `${row.shape.padEnd(10)} read ${row.read.toFixed(2)} ns   write ${row.write.toFixed(2)} ns`,
        )
    console.log(lines.join('\n'))
})
