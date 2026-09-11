// The leaf's five refusals, each with the number it reports with the mechanism out.
// The tool that asserts work is a tool whose own bugs are silent, so it gets the
// discipline it imposes.

import { expect, test } from 'bun:test'
import { inAFreshProcess } from 'harness/gate'
import {
    clockResolution,
    nanoseconds,
    ratio,
    type Sample,
    THRESHOLDS,
} from 'harness/report'

const IMPORTS = `import { batch } from '${new URL('../src/report/index.ts', import.meta.url).pathname}'`

test('the clock reports a measured resolution, not an assumed one', () => {
    const step = clockResolution()
    // 41 ns here under bun; the 100 µs figure quoted for browsers would over-batch by
    // ~2400x, and a cross-origin-isolated page at 5 µs is a 20x error the other way.
    expect(step).toBeGreaterThan(0)
    expect(step).toBeLessThan(THRESHOLDS.frame)
    const before = nanoseconds()
    expect(nanoseconds() - before).toBeGreaterThanOrEqual(0)
})

// Refusal 5. Reverted — take the sample — this returns a ratio priced against seven
// other workers, and with a MEASURED floor the floor goes so wide under contention
// that every real regression reads as `underTheFloor`: a gate that stops gating
// without failing.
//
// Run in a child rather than in this process, because the mark is read at import and
// the suite's own mode would otherwise decide which half of the gate ran.
test('the batcher throws in a parallel worker, and not outside one', () => {
    const call = `batch({ case: 'c', arms: { one: () => { Math.sqrt(2) }, two: () => { Math.sqrt(3) } }, emulated: null, reps: 1, warmup: 1 })`
    const marked = inAFreshProcess(`${IMPORTS}\n${call}`, '3')
    expect(marked.ok).toBe(false)
    expect(marked.output).toContain('test:serial')
    expect(marked.output).toContain('parallel worker 3')

    const unmarked = inAFreshProcess(`${IMPORTS}\n${call}`)
    expect(unmarked.output).not.toContain('test:serial')
    expect(unmarked.ok).toBe(true)
})

// Refusal 4. Reverted — predicate on `substrate === 'jsc' && unit === 'ms'` — a
// build-time µs and a TTFB are refused and a `ns` spelling walks through.
test('the batcher throws on a duration whose op touched an emulated DOM', () => {
    // In a child, because the worker refusal is checked first and `bun run test` is
    // `--parallel` — the suite's own mode would otherwise decide which throw this saw.
    const run = inAFreshProcess(
        `${IMPORTS}\nbatch({ case: 'emulated', arms: { abide: () => {}, vanilla: () => {} }, emulated: 'dom' })`,
    )
    expect(run.ok).toBe(false)
    expect(run.output).toContain('happy-dom can produce a count')
})

// Refusal 3. Reverted — return the sample anyway — an empty body at n=1 comes back as
// 0 ns and is quoted as a result.
test('the batcher throws on a sample under 100x the clock', () => {
    const run = inAFreshProcess(
        `${IMPORTS}\nbatch({ case: 'trivial', arms: { one: () => {}, two: () => {} }, emulated: null, n: 1, reps: 1, warmup: 0 })`,
    )
    expect(run.ok).toBe(false)
    expect(run.output).toContain("under 100x the clock's measured resolution")
})

// The growth half of the same refusal, and the record of the n it used: a per-op
// figure at n=10,000 has different GC and cache behaviour than at n=10, so the number
// is carried rather than discarded.
test('the batcher grows n until the sample clears the bar, and records it', () => {
    const run = inAFreshProcess(
        `${IMPORTS}
const done = batch({
    case: 'trivial',
    arms: { one: () => { Math.sqrt(2) }, two: () => { Math.sqrt(3) } },
    emulated: null,
    reps: 3,
    warmup: 1,
})
if (done.n <= 1) throw new Error('n did not grow: ' + done.n)
if (done.samples.one.n !== done.n) throw new Error('sample does not carry n')
if (done.samples.two.n !== done.n) throw new Error('arms disagree on n')
if ('one (A/A)' in done.samples) throw new Error('the control leaked into the reported arms')
if (!(done.floor >= 0)) throw new Error('no measured floor')
console.log('n=' + done.n + ' floor=' + done.floor)`,
    )
    expect(run.ok).toBe(true)
    expect(run.output).toMatch(/n=\d+ floor=/)
})

function sampleOf(over: Partial<Sample>): Sample {
    return {
        arm: 'abide',
        case: 'swap two rows of 500',
        n: 64,
        reps: 7,
        warmup: 3,
        substrate: 'jsc',
        emulated: null,
        nanoseconds: 1000,
        p95: 1200,
        underOneFrame: false,
        work: null,
        ...over,
    }
}

// Reverted — compare the numbers — 1.67x and 0.21x get averaged, which is a claim
// about neither engine.
test('ratio() throws across substrates', () => {
    expect(() =>
        ratio(sampleOf({}), sampleOf({ arm: 'vanilla', substrate: 'v8' }), {
            floor: 0,
        }),
    ).toThrow(/jsc arm and a v8 arm/)
})

// Reverted — compare them — every ratio in the repo measures one arm against itself
// and nothing about the output moves.
test('ratio() refuses two samples with the same arm', () => {
    expect(() => ratio(sampleOf({}), sampleOf({}), { floor: 0 })).toThrow(
        /twice/,
    )
})

test('ratio() refuses two cases and two batch sizes', () => {
    expect(() =>
        ratio(sampleOf({}), sampleOf({ arm: 'vanilla', case: 'other' }), {
            floor: 0,
        }),
    ).toThrow(/two cases/)
    expect(() =>
        ratio(sampleOf({}), sampleOf({ arm: 'vanilla', n: 8 }), { floor: 0 }),
    ).toThrow(/n=64 against n=8/)
})

// The tag cannot be stringified into a numeric cell. Reverted — drop the tag at the
// division — two frame-quantised samples come back as 1.01x, which is `read-invoice`'s
// hand-typed First paint row reproduced by the producer that exists to refuse it.
test('ratio() will not divide two frame-quantised samples', () => {
    const abide = sampleOf({
        n: 1,
        nanoseconds: 16_800_000,
        underOneFrame: true,
    })
    const vanilla = sampleOf({
        arm: 'vanilla',
        n: 1,
        nanoseconds: 16_700_000,
        underOneFrame: true,
    })
    const answer = ratio(abide, vanilla, { floor: 0 })
    expect(answer.kind).toBe('underOneFrame')
    expect(answer).not.toHaveProperty('value')
})

// The floor is a number with a provenance. Reverted to "two runs, and if the arms swap
// places it is noise", this is a sign test at n=2 and misses noise half the time.
test('a ratio inside the measured floor comes back tagged rather than numeric', () => {
    const inside = ratio(
        sampleOf({ nanoseconds: 1020 }),
        sampleOf({ arm: 'vanilla', nanoseconds: 1000 }),
        { floor: 0.05 },
    )
    expect(inside.kind).toBe('underTheFloor')
    const outside = ratio(
        sampleOf({ nanoseconds: 2000 }),
        sampleOf({ arm: 'vanilla', nanoseconds: 1000 }),
        { floor: 0.05 },
    )
    expect(outside).toMatchObject({ kind: 'ratio', value: 2 })
})

// SHARED SOURCE IS NOT SHARED WORK. Two arms ran byte-identical page source 4.5x
// apart because only one shipped a stylesheet, so the faster arm was not doing the
// work at all. Reverted — divide without looking at `work` — the flag is empty and
// the 4.5x reads as an existence proof.
test('ratio() flags two arms whose work counters disagree', () => {
    const answer = ratio(
        sampleOf({ work: { elementsMoved: 2, recalcStyleCount: 0 } }),
        sampleOf({
            arm: 'vanilla',
            work: { elementsMoved: 2, recalcStyleCount: 9 },
        }),
        { floor: 0 },
    )
    expect(answer.workDisagreement).toEqual([
        'recalcStyleCount: abide 0, vanilla 9',
    ])
})
