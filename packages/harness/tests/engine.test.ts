// `shares()` is a pure function of a `Trace` and is gated here, in bun, where the
// driver that produces one cannot run. The lane's live half — the CDP session and
// the four counters — is gated in `packages/harness/e2e/engine.spec.ts`, because an
// engine number is not available inside a case body and never will be.

import { expect, test } from 'bun:test'
import { shares, type Trace } from 'harness/engine'
import { THRESHOLDS } from 'harness/report'

function traceOf(
    measures: [name: string, start: number, end: number][],
): Trace {
    return {
        op: 'click-to-paint',
        measures: measures.map(([name, start, end]) => ({
            name,
            startNanoseconds: start,
            endNanoseconds: end,
        })),
        counters: { recalcStyle: 1, layout: 1, paint: 2, forcedLayout: 0 },
        layers: { style: 43_000, layout: 106_000, script: 105_000 },
    }
}

// The stage's own gate. `within` was there to compose — a fraction of click -> paint
// times a fraction of navigation -> paint — and the reconcile does not run inside
// navigation -> paint; hydration does. Reverted — accept it and multiply — the
// product describes no op at all, and a first-load ceiling gets quoted as bounding
// an interaction.
test('shares() refuses a `within`', () => {
    const trace = traceOf([
        ['click-to-paint', 0, 1_450_000],
        ['reconcile', 100_000, 180_000],
    ])
    expect(() =>
        shares(trace, {
            layer: 'reconcile',
            of: 'click-to-paint',
            threshold: 'frame',
            within: 'navigation-to-paint',
        } as Parameters<typeof shares>[1]),
    ).toThrow(/first load and interaction are two/)
})

// A DENOMINATOR THAT IS OPTIONAL IS A DENOMINATOR SOMEBODY OMITS. Two reactive-core
// rewrites landed as no-ops because the path they improved is 0.055 of a 1.45 ms op.
test('shares() prices the layer against the whole op somebody waits on', () => {
    const answer = shares(
        traceOf([
            ['click-to-paint', 0, 1_450_000],
            ['reconcile', 100_000, 180_000],
        ]),
        { layer: 'reconcile', of: 'click-to-paint', threshold: 'frame' },
    )
    expect(answer.ceilingCpu).toBeCloseTo(80_000 / 1_450_000, 6)
    expect(answer.layerNanoseconds).toBe(80_000)
})

// TWO CEILINGS, BECAUSE A CPU SHARE IS NOT A LATENCY. Click -> paint is frame
// quantised, so removing 4.3% of an op that is going to be rounded up to the next
// frame boundary changes observed latency by exactly zero. Reverted to one `ceiling`
// "which is what gets written down", a 4.3% CPU share is quoted as 4.3% of the wait.
test('an op under one frame has an observed ceiling of zero', () => {
    const answer = shares(
        traceOf([
            ['click-to-paint', 0, 7_800_000],
            ['reconcile', 100_000, 800_000],
        ]),
        { layer: 'reconcile', of: 'click-to-paint', threshold: 'frame' },
    )
    expect(answer.underOneFrame).toBe(true)
    expect(answer.ceilingObserved).toBe(0)
    expect(answer.ceilingCpu).toBeGreaterThan(0)
    expect(answer.overTheThreshold).toBe(false)
})

test('an op over the threshold reports both ceilings', () => {
    const answer = shares(
        traceOf([
            ['click-to-paint', 0, THRESHOLDS.interaction * 2],
            ['reconcile', 0, THRESHOLDS.interaction / 2],
        ]),
        { layer: 'reconcile', of: 'click-to-paint', threshold: 'interaction' },
    )
    expect(answer.underOneFrame).toBe(false)
    expect(answer.overTheThreshold).toBe(true)
    expect(answer.ceilingObserved).toBe(answer.ceilingCpu)
})

// CONTAINMENT IS CHECKED, not assumed — the assumption the withdrawn `within`
// violated silently. Reverted — sum every measure of that name — a second flush or
// an idle pass outside the op comes back as a SMALLER fraction, which is the wrong
// direction and reads as good news.
test('a layer running outside the op is a throw, not a smaller fraction', () => {
    expect(() =>
        shares(
            traceOf([
                ['click-to-paint', 0, 1_450_000],
                ['reconcile', 100_000, 180_000],
                ['reconcile', 2_000_000, 2_100_000],
            ]),
            { layer: 'reconcile', of: 'click-to-paint', threshold: 'frame' },
        ),
    ).toThrow(/running outside it/)
})

test('shares() refuses a denominator the trace does not name once', () => {
    expect(() =>
        shares(traceOf([['reconcile', 0, 10]]), {
            layer: 'reconcile',
            of: 'click-to-paint',
            threshold: 'frame',
        }),
    ).toThrow(/found 0 measures/)
    expect(() =>
        shares(traceOf([['click-to-paint', 0, 10]]), {
            layer: 'reconcile',
            of: 'click-to-paint',
            threshold: 'frame',
        }),
    ).toThrow(/found no measure named "reconcile"/)
})
