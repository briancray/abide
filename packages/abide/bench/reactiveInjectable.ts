// THE SAME CASES, RUN IN THE READER'S ENGINE. Injected into a page so the reactive
// core is priced under V8 and under WebKit's JSC against the same hand-written arm and
// the same batcher that prices it under bun.
//
// This is not a nicety. CLAUDE.md records a graph that measured 1.67x a hand-written
// signal in one engine and 0.21x in another — INVERTED, not scaled — so a design
// decision taken on one engine's numbers is taken on a coin flip. `batch()` already
// carries the refusals that matter here: it measures the clock's resolution rather
// than assuming it, and a browser's is ~100 µs against bun's 41 ns.

import { runReactive } from './reactiveRun.ts'

;(
    globalThis as unknown as { __REACTIVE_BENCH__: typeof runReactive }
).__REACTIVE_BENCH__ = runReactive
