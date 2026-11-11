// THE REACTIVE CORE, PRICED IN THE ENGINES A READER ACTUALLY BRINGS. Chromium is V8 and
// Safari is JSC-in-a-browser; `bun run bench:reactive` is JSC-under-bun. Three points,
// one set of cases, one batcher.
//
// It reports rather than asserts. A threshold here would be a threshold on somebody
// else's machine under somebody else's load — what this is for is the SIGN of a ratio,
// which is the thing CLAUDE.md records as inverting between engines. At full size only under
// `bun run bench` — `BENCH_SIZING`.

import { test } from '@playwright/test'

import { buildBench } from '../bench/buildBench.ts'
import type { ReactiveBenchRow } from '../bench/reactiveRun.ts'
import { BENCH_SIZING } from './BENCH_SIZING.ts'

const built = await buildBench('reactive')

// WEBKIT CANNOT PRICE THESE INSIDE A GATE: its clock is 1 ms, so 43.11's bar is 100 ms a sample
// and `batch()` refuses rather than report the clock. `list.spec.ts` carries the whole reason.
test.skip(
    ({ browserName }) => browserName === 'webkit',
    'webkit coarsens its clock to 1 ms; 43.11 cannot be met inside a gate budget',
)

test('the reactive core against the hand-written arm, in this engine', async ({
    page,
}, testInfo) => {
    // A browser clock is ~100 µs where bun's is 41 ns, so every case batches to a far
    // larger n and the whole run is minutes rather than seconds — and the batcher's default
    // two-second ceiling is not enough to reach it, so the budget handed in is twenty.
    test.setTimeout(15 * 60 * 1000)
    await page.addInitScript({ content: built })
    // `setContent` on a page still on its initial `about:blank` reruns no init script
    // — nothing navigated — so the injection would be silently absent.
    await page.goto('about:blank')
    await page.setContent('<!doctype html><html><body></body></html>')

    const rows = (await page.evaluate(
        (sizing) =>
            (
                globalThis as unknown as {
                    __REACTIVE_BENCH__: (
                        budget: number,
                        sizing?: typeof BENCH_SIZING,
                    ) => ReactiveBenchRow[]
                }
            ).__REACTIVE_BENCH__(20_000_000_000, sizing),
        BENCH_SIZING,
    )) as ReactiveBenchRow[]
    if (BENCH_SIZING) return
    const { formatReactive } = await import('../bench/reactiveRun.ts')
    console.log(`\n=== ${testInfo.project.name} ===\n${formatReactive(rows)}`)
})
