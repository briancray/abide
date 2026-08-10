// The test kit, asserted through its own public entry point.
//
// `abide/tests` is surface like any other, and every case in `demos/` runs THROUGH it — so a change
// to what `is` counts as equal, or to where the noise band sits, moves every claim on every page
// silently and in the same direction. Nothing else in the example reaches these names: a demo asserts
// with the kit rather than about it, which is exactly why they had no reader.
//
// Here rather than in `demos/` because a demo is a page about the APP's capabilities, and the runner
// is not one of them — a card titled "the harness works" is furniture, not a claim about abide.

import { describe, expect, test } from 'bun:test'
import { AssertionError, equals, NOISE, quiesce, smokeBench, timeArms } from 'abide/tests'

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
        // off the constant rather than spelled again, so a widened band moves this with it.
        const inside = 1 + NOISE / 2
        expect(inside).toBeLessThan(1 + NOISE)
        expect(1 / inside).toBeGreaterThan(1 - NOISE)
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
            // The field nothing read: without it a ns/op is a number with no sample size behind it,
            // and `spread` beside it cannot be interpreted.
            expect(timing.ops).toBeGreaterThan(0)
            expect(Number.isFinite(timing.nsPerOp)).toBe(true)
            expect(timing.spread).toBeGreaterThanOrEqual(1)
        }
    })
})
