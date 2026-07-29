// The map-back step both type lanes share. Every failure mode here is a SILENT DROP — a diagnostic
// that vanishes rather than an error that surfaces — so `abide check` going green on a file with type
// errors is what "broken" looks like. That is why this is unit-tested rather than left to the two
// lanes' end-to-end tests, which can only observe the drop as an absence.

import { describe, expect, test } from 'bun:test'
import {
    type GeneratedModule,
    indexByGeneratedPath,
    offsetToLineColumn,
    resolveAbidePosition,
    resolveAbideRange,
} from './abideDiagnostic.ts'
import { CHECK_HEADER_LENGTH, mapGenToOrig } from './emitCheck.ts'

// A module whose segment map is the identity SHIFTED BY THE HEADER: generated offset
// `CHECK_HEADER_LENGTH + n` maps to source offset `n`. That is the real relationship `emitCheck`
// produces for a body emitted verbatim, so a test can reason about positions directly without
// depending on the whole lowering — while still using the real `Segment` shape
// (`{ genStart, genEnd, origStart }`). A shim that invents its own field names would type-check
// against nothing and quietly test a different function.
function moduleFor(tsPath: string, source: string): GeneratedModule {
    return {
        abidePath: '/p/X.abide',
        tsPath,
        source,
        segments: [
            {
                genStart: CHECK_HEADER_LENGTH,
                genEnd: CHECK_HEADER_LENGTH + source.length,
                origStart: 0,
            },
        ],
    }
}

const SOURCE = 'line one\nline two\nline three'

describe('indexByGeneratedPath + resolveAbidePosition', () => {
    test('resolves a diagnostic on a generated module to its .abide position', () => {
        const module = moduleFor('/p/__abide_check_X_abide.ts', SOURCE)
        const index = indexByGeneratedPath([module])
        const resolved = resolveAbidePosition(
            {
                file: '/p/__abide_check_X_abide.ts',
                pos: CHECK_HEADER_LENGTH + 9,
                code: 1,
                text: 'x',
            },
            index,
        )
        expect(resolved?.module).toBe(module)
        expect(resolved?.line).toBe(2)
        expect(resolved?.column).toBe(1)
    })

    // Trap 1. tsgo canonicalizes the path it reports on a case-insensitive filesystem, so a generated
    // name carrying ANY uppercase can come back lowercased. `check.ts` keyed case-sensitively and
    // dropped every diagnostic for such a file while reporting success.
    test('matches when tsgo reports the path in a different CASE', () => {
        const module = moduleFor('/Users/dev/Code/__abide_check_MyWidget_abide.ts', SOURCE)
        const index = indexByGeneratedPath([module])
        const resolved = resolveAbidePosition(
            {
                file: '/users/dev/code/__abide_check_mywidget_abide.ts',
                pos: CHECK_HEADER_LENGTH,
                code: 1,
                text: 'x',
            },
            index,
        )
        expect(resolved?.module).toBe(module)
    })

    // Trap 2. The synthetic preamble is not the author's code; a diagnostic inside it would map back to
    // a position that means nothing in their file.
    test('drops a diagnostic that lands inside the synthetic header', () => {
        const index = indexByGeneratedPath([moduleFor('/p/__abide_check_X_abide.ts', SOURCE)])
        expect(
            resolveAbidePosition(
                {
                    file: '/p/__abide_check_X_abide.ts',
                    pos: CHECK_HEADER_LENGTH - 1,
                    code: 1,
                    text: 'x',
                },
                index,
            ),
        ).toBeUndefined()
    })

    test('drops a diagnostic on a file this lane did not generate', () => {
        const index = indexByGeneratedPath([moduleFor('/p/__abide_check_X_abide.ts', SOURCE)])
        expect(
            resolveAbidePosition(
                { file: '/p/somewhere/else.ts', pos: CHECK_HEADER_LENGTH, code: 1, text: 'x' },
                index,
            ),
        ).toBeUndefined()
    })

    test('an empty index resolves nothing rather than throwing', () => {
        expect(
            resolveAbidePosition(
                { file: '/p/anything.ts', pos: CHECK_HEADER_LENGTH, code: 1, text: 'x' },
                indexByGeneratedPath([]),
            ),
        ).toBeUndefined()
    })
})

// The RANGE map-back, whose trap is the EXCLUSIVE END. `mapGenToOrig`'s segments are half-open, so a
// generated end offset lands ON a boundary and is not inside the segment it terminates — it snaps
// FORWARD to the next segment's origin. Hover carried the "map the last char, then +1" correction with
// a comment; `declToLocation`, which backs BOTH go-to-definition and find-references, mapped the end
// raw, so those two could report a range ending at an unrelated later token.
describe('resolveAbideRange', () => {
    // Two verbatim spans with a GAP in the original — the shape `emitCheck` produces whenever it
    // injects synthetic scaffolding between two user expressions. `a`'s generated end is exactly `b`'s
    // generated start, which is where a raw end-offset map goes wrong.
    const twoSegments: GeneratedModule = {
        abidePath: '/p/X.abide',
        tsPath: '/p/x.ts',
        source: 'aaaa....................bbbb',
        segments: [
            { genStart: CHECK_HEADER_LENGTH, genEnd: CHECK_HEADER_LENGTH + 4, origStart: 0 },
            { genStart: CHECK_HEADER_LENGTH + 4, genEnd: CHECK_HEADER_LENGTH + 8, origStart: 24 },
        ],
    }

    test('a span ending on a segment boundary stays inside its own segment', () => {
        // The whole of the first segment: generated [H, H+4) → original [0, 4).
        expect(
            resolveAbideRange(twoSegments, CHECK_HEADER_LENGTH, CHECK_HEADER_LENGTH + 4),
        ).toEqual({ start: 0, end: 4 })
        // Mapping the end RAW is what the bug did: `mapGenToOrig(segments, H+4)` is 24, the SECOND
        // segment's origin, so the range ran from 0 to 24 — across twenty characters the span never
        // covered. Asserted here so the guard states the wrong answer it exists to exclude.
        expect(mapGenToOrig(twoSegments.segments, CHECK_HEADER_LENGTH + 4)).toBe(24)
    })

    test('a span inside one segment maps straight through', () => {
        expect(
            resolveAbideRange(twoSegments, CHECK_HEADER_LENGTH + 1, CHECK_HEADER_LENGTH + 3),
        ).toEqual({ start: 1, end: 3 })
    })

    test('the header, an empty span and an inverted span are all drops', () => {
        expect(resolveAbideRange(twoSegments, 0, CHECK_HEADER_LENGTH + 4)).toBeUndefined()
        expect(
            resolveAbideRange(twoSegments, CHECK_HEADER_LENGTH, CHECK_HEADER_LENGTH),
        ).toBeUndefined()
        expect(
            resolveAbideRange(twoSegments, CHECK_HEADER_LENGTH + 4, CHECK_HEADER_LENGTH + 1),
        ).toBeUndefined()
    })
})

describe('offsetToLineColumn', () => {
    test.each([
        [0, 1, 1],
        [4, 1, 5],
        [9, 2, 1],
        [18, 3, 1],
    ])('offset %i → line %i column %i (both 1-based)', (offset, line, column) => {
        expect(offsetToLineColumn(SOURCE, offset)).toEqual({ line, column })
    })

    test('an offset past the end clamps to the last position rather than running off', () => {
        const { line } = offsetToLineColumn(SOURCE, SOURCE.length + 500)
        expect(line).toBe(3)
    })
})
