// THE SAME CASES, RUN IN THE READER'S ENGINE. Injected into a page so the reactive
// core is priced under V8 and under WebKit's JSC against the same hand-written arm and
// the same batcher that prices it under bun.
//
// This is not a nicety. CLAUDE.md records a graph that measured 1.67x a hand-written
// signal in one engine and 0.21x in another — INVERTED, not scaled — so a design
// decision taken on one engine's numbers is taken on a coin flip. `batch()` already
// carries the refusals that matter here: it measures the clock's resolution rather
// than assuming it, and a browser's is ~100 µs against bun's 41 ns.

import {
    batch,
    type BatchSpec,
    claimOf,
    emulatedDom,
    ratio,
    type Sample,
} from '@abide/harness/report'

import { type ReactiveBenchRow, reactiveCases } from './reactiveCases.ts'

function run(sizing?: Pick<BatchSpec, 'reps' | 'warmup'>): ReactiveBenchRow[] {
    const rows: ReactiveBenchRow[] = []
    for (const kase of reactiveCases()) {
        const measured = batch({
            case: kase.name,
            arms: { vanilla: kase.vanilla, abide: kase.abide },
            emulated: emulatedDom(),
            // A browser clock is ~2,400x coarser than bun's, so n grows far higher and
            // the default two-second ceiling is not enough to reach it.
            budgetNanoseconds: 20_000_000_000,
            ...sizing,
        })
        const counted = kase.work()
        const vanillaSample: Sample = {
            ...(measured.samples.vanilla as Sample),
            work: counted.vanilla,
        }
        const abideSample: Sample = {
            ...(measured.samples.abide as Sample),
            work: counted.abide,
        }
        const result = ratio(abideSample, vanillaSample, {
            floor: measured.floor,
        })
        rows.push({
            case: kase.name,
            abide: abideSample.nanoseconds,
            vanilla: vanillaSample.nanoseconds,
            claim: claimOf(result),
            n: measured.n,
            floor: measured.floor,
            substrate: measured.substrate,
            workDisagreement: result.workDisagreement,
        })
    }
    return rows
}

;(
    globalThis as unknown as { __REACTIVE_BENCH__: typeof run }
).__REACTIVE_BENCH__ = run
