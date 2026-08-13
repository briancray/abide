// The kit, asserted through its own public entry points.
//
// Every case in the example runs THROUGH this, so a change to what `is` counts as equal, or to where
// the noise band sits, moves every claim on every page silently and in the same direction. `equals`,
// `NOISE` and `smokeBench` have no other reader in the example: a demo asserts with the kit rather
// than about it, which is why they had none at all. `timeArms`, `quiesce` and `verdict` do have one —
// `site/bench.ts` paints every bench row with them, and `verdict` picks the tail and tone — so a
// change there is not contained by this file.
//
// Beside the kit rather than in the app that consumes it, which is what the package split buys: the
// runner is not one of the app's capabilities, and a page titled "the harness works" would be
// furniture rather than a claim about abide.
//
// The two import lines below are the layering, asserted by being written: `smokeBench` knows what a
// `Case` is and `timeArms` does not know what abide is.

import { describe, expect, test } from 'bun:test'
import { AssertionError, equals, smokeBench } from 'abide-kit'
import { NOISE, quiesce, timeArms, verdict } from 'abide-kit/measure'

// Run from the REPO ROOT. `bunfig.toml`'s preload is what puts a document here, and bun reads a bunfig
// from the current directory only — so `cd packages/abide-kit && bun test` runs this file against no
// DOM at all.
//
// Stated as a throw rather than left to fail on its own, because it does NOT fail on its own: `frame()`
// checks `typeof requestAnimationFrame` before it touches `document`, so without a DOM it short-circuits
// to its `MessageChannel` branch and every timing assertion below passes while measuring a different
// path. A file whose substrate depends on which directory it was started from is one that reports green
// for two different things.
if (typeof document === 'undefined') {
    throw new Error('abide-kit: run `bun test` from the repo root — the DOM preload is in its bunfig.toml')
}

describe('equals — what `is` means by equal', () => {
    test('structural, not identity', () => {
        expect(equals({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
        expect(equals([1, 2], [1, 2])).toBe(true)
        // Order matters in an array and not in an object: one is a sequence, the other a set of keys.
        expect(equals([1, 2], [2, 1])).toBe(false)
        expect(equals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    })

    test('a missing key is not an undefined one', () => {
        // The distinction a demo asserting `params` relies on: `{}` and `{ id: undefined }` are two
        // different answers about whether a segment was there.
        expect(equals({}, { id: undefined })).toBe(false)
    })

    test('`Object.is` semantics at the leaves — NaN matches, and -0 does not match 0', () => {
        expect(equals(Number.NaN, Number.NaN)).toBe(true)
        expect(equals(0, -0)).toBe(false)
    })

    test('anything with a prototype of its own compares by IDENTITY', () => {
        // A Map, a Set, a cell, a DOM node. This is the rule most likely to surprise: two Maps with
        // the same entries are NOT equal, so a case asserting one has to spread it — which is what
        // the `tracestate` assertion in the serve tests does.
        const map = new Map([['a', 1]])
        expect(equals(map, map)).toBe(true)
        expect(equals(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(false)
        expect(equals(new Set([1]), new Set([1]))).toBe(false)
        // …and spread, they compare like the plain structures they became.
        expect(equals([...new Map([['a', 1]])], [['a', 1]])).toBe(true)
    })

    test('an Error compares by name and message, so a throw is assertable', () => {
        expect(equals(new TypeError('boom'), new TypeError('boom'))).toBe(true)
        expect(equals(new TypeError('boom'), new RangeError('boom'))).toBe(false)
        expect(equals(new TypeError('boom'), new TypeError('other'))).toBe(false)
    })
})

describe('AssertionError — what the card and the runner both catch', () => {
    test('a bench arm that counts nothing finite is an assertion failure, by name', () => {
        // `smokeBench` is what `runHeadless` puts every bench through, and this is the one thing it
        // asserts: an arm still runs and still answers with a number. Caught by TYPE here, which is
        // the reason `AssertionError` is exported at all — the browser card and `bun test` both have
        // to tell a failed claim from a broken case.
        const broken = smokeBench({
            kind: 'wake',
            arms: [{ label: 'counts nothing', run: async () => ({ count: Number.NaN, of: 'wake-ups' }) }],
        })
        return broken.then(
            () => {
                throw new Error('smokeBench accepted a non-finite count')
            },
            (failure: unknown) => {
                expect(failure).toBeInstanceOf(AssertionError)
                expect((failure as AssertionError).message).toContain('counts nothing')
            },
        )
    })

    test('…and a finite one passes', async () => {
        await smokeBench({
            kind: 'wake',
            arms: [{ label: 'counts one', run: async () => ({ count: 1, of: 'wake-ups' }) }],
        })
    })
})

describe('the noise band', () => {
    test('NOISE is the width of `same`, from either side', () => {
        // `verdict` buckets a ratio, and NOISE is what makes it three buckets rather than two. Read
        // off the constant rather than spelled again, so a widened band moves this with it — and
        // asserted through `verdict` rather than about the number, because a band that lost its
        // lower half prints "same, within noise" over an arm that is genuinely faster, and
        // arithmetic over the constant alone cannot tell.
        expect(verdict(1 + NOISE / 2, 1)).toBe('same')
        expect(verdict(1, 1 + NOISE / 2)).toBe('same')
        expect(verdict(1 + NOISE * 2, 1)).toBe('slower')
        expect(verdict(1, 1 + NOISE * 2)).toBe('faster')
    })
})

describe('Timing.ops — how many operations a number is the average of', () => {
    test('every arm reports the count its ns/op was divided by', async () => {
        const timings = await timeArms(
            [
                { label: 'a', run: () => undefined },
                { label: 'b', run: () => undefined },
            ],
            quiesce,
        )
        expect(timings.length).toBe(2)
        for (const timing of timings) {
            // The field nothing read: without it a ns/op is a number with no sample size behind it.
            // Bounded well above `PASSES` rather than above zero, because `ops` is `batch * PASSES`
            // and a no-op arm calibrates its batch against BATCH_TARGET_MS — so this is the bound
            // that separates the real count from `PASSES` alone or from any small constant, which
            // `> 0` did not.
            expect(timing.ops).toBeGreaterThan(10_000)
            expect(Number.isFinite(timing.nsPerOp)).toBe(true)
        }
        // `spread` is deliberately not asserted here. It is `median(samples) / min(samples)`, so
        // `>= 1` holds for every possible implementation including a hardcoded `1` — it was
        // arithmetic, not a claim. Making it falsifiable needs pass-to-pass variance a test cannot
        // schedule, so what guards it is `site/bench.ts`'s NOISY_SPREAD warning, on a real run.
    })
})
