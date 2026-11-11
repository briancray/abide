// THE SAME CASES, RUN IN THE READER'S ENGINE. Injected into a page so the reactive
// core is priced under V8 and under WebKit's JSC against the same hand-written arm and
// the same batcher that prices it under bun.
//
// This is not a nicety. CLAUDE.md records a graph that measured 1.67x a hand-written
// signal in one engine and 0.21x in another — INVERTED, not scaled — so a design
// decision taken on one engine's numbers is taken on a coin flip. `batch()` already
// carries the refusals that matter here: it measures the clock's resolution rather
// than assuming it, and a browser's is ~100 µs against bun's 41 ns.

import type { BatchSpec } from '@abide/harness/report'

import { runReactive } from './reactiveRun.ts'

function run(sizing?: Pick<BatchSpec, 'reps' | 'warmup'>) {
    // A browser clock is ~2,400x coarser than bun's, so n grows far higher and
    // the default two-second ceiling is not enough to reach it.
    return runReactive({ budgetNanoseconds: 20_000_000_000, ...sizing })
}

;(
    globalThis as unknown as { __REACTIVE_BENCH__: typeof run }
).__REACTIVE_BENCH__ = run
