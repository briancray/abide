// THE REACTIVE CORE, PRICED IN THE ENGINES A READER ACTUALLY BRINGS. Chromium is V8 and
// Safari is JSC-in-a-browser; `bun run bench:reactive` is JSC-under-bun. Three points,
// one set of cases, one batcher.
//
// It reports rather than asserts. A threshold here would be a threshold on somebody
// else's machine under somebody else's load — what this is for is the SIGN of a ratio,
// which is the thing CLAUDE.md records as inverting between engines.

import { execFileSync } from 'node:child_process'
import { test } from '@playwright/test'

const REPO = new URL('../../../', import.meta.url).pathname

type Row = {
    case: string
    abide: number
    vanilla: number
    claim: string
    n: number
    floor: number
    substrate: string
    workDisagreement: string[]
}

const built = execFileSync(
    'bun',
    ['packages/harness/scripts/buildBench.ts', 'reactive'],
    { cwd: REPO, encoding: 'utf8' },
).trim()

test('the reactive core against the hand-written arm, in this engine', async ({
    page,
}, testInfo) => {
    // A browser clock is ~100 µs where bun's is 41 ns, so every case batches to a far
    // larger n and the whole run is minutes rather than seconds.
    test.setTimeout(15 * 60 * 1000)
    await page.addInitScript({ path: built })
    // `setContent` on a page still on its initial `about:blank` re-runs no init script
    // — nothing navigated — so the injection would be silently absent.
    await page.goto('about:blank')
    await page.setContent('<!doctype html><html><body></body></html>')

    const rows = (await page.evaluate(() =>
        (
            globalThis as unknown as { __REACTIVE_BENCH__: () => Row[] }
        ).__REACTIVE_BENCH__(),
    )) as Row[]

    const lines = [`\n=== ${testInfo.project.name} ===`]
    for (const row of rows) {
        lines.push(
            `${row.case}\n  abide ${row.abide.toFixed(1)} ns   vanilla ${row.vanilla.toFixed(1)} ns   ${row.claim}   [n=${row.n} floor=${(row.floor * 100).toFixed(2)}% ${row.substrate}]`,
        )
        if (row.workDisagreement.length > 0)
            lines.push(`  WORK DISAGREES — ${row.workDisagreement.join('; ')}`)
    }
    console.log(lines.join('\n'))
})
