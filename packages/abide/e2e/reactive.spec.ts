// THE REACTIVE CORE, PRICED IN THE ENGINES A READER ACTUALLY BRINGS. Chromium is V8 and
// Safari is JSC-in-a-browser; `bun run bench:reactive` is JSC-under-bun. Three points,
// one set of cases, one batcher.
//
// It reports rather than asserts. A threshold here would be a threshold on somebody
// else's machine under somebody else's load — what this is for is the SIGN of a ratio,
// which is the thing CLAUDE.md records as inverting between engines. At full size only under
// `bun run bench` — `BENCH_SIZING`.

import { test } from '@playwright/test'

import { openInjected } from '../../harness/scripts/buildInjectable.ts'
import type { ArmsBench } from '../bench/armsRun.ts'
import { buildBench } from '../bench/buildBench.ts'
import { BENCH_SIZING } from './BENCH_SIZING.ts'
import { skipWebkitClock } from './skipWebkitClock.ts'

const built = await buildBench('reactive')

// Under `bun run bench` too: there "construct a keyed value" spent its 20 s budget at
// n=21,748,243 after 1 of 10 reps.
skipWebkitClock()

test('the reactive core against the hand-written arm, in this engine', async ({
    page,
}, testInfo) => {
    // A browser clock is ~100 µs where bun's is 41 ns, so every case batches to a far
    // larger n and the whole run is minutes rather than seconds — and the batcher's default
    // two-second ceiling is not enough to reach it, so the budget handed in is twenty.
    test.setTimeout(15 * 60 * 1000)
    await openInjected(page, built)

    const rows = await page.evaluate(
        (sizing) =>
            (
                globalThis as unknown as {
                    __REACTIVE_BENCH__: ArmsBench
                }
            ).__REACTIVE_BENCH__(20_000_000_000, sizing),
        BENCH_SIZING,
    )
    if (BENCH_SIZING) return
    const { formatArms } = await import('../bench/armsRun.ts')
    console.log(`\n=== ${testInfo.project.name} ===\n${formatArms(rows)}`)
})
