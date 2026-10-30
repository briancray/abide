// 23.24, 23.25, 30.36 — A PARAM FILE, READ OFF ITS TOKENS: one flagless regex literal exported under
// the name the file is filed under, nothing that backtracks without bound, and the dot-segment floor
// written into what the route tables carry.

import { expect, test } from 'bun:test'

import { matcherOf, runawayIn } from '#compiler/paramFile.ts'

const TICKER = 'holdings/TICKER.param.ts'

// THE REVERT: return the body unanchored from `matcherOf`; `BRK.B.X` matches as a prefix, and
// `..` passes a matcher that admits any text.
test('a param file declares one anchored matcher, and never a dot-segment — 23.24, 30.36', () => {
    const source = matcherOf(
        TICKER,
        '// A ticker, a share class after a period included.\nexport const TICKER = /[A-Z]+(?:\\.[A-Z]+)?/\n',
    )
    expect(typeof source).toBe('string')
    const accepts = new RegExp(source as string)
    expect(accepts.test('BRK.B')).toBe(true)
    expect(accepts.test('BRK.B.X')).toBe(false)
    expect(accepts.test('brk')).toBe(false)
    const anything = new RegExp(
        matcherOf('SLUG.param.ts', 'export const SLUG = /.+/;') as string,
    )
    expect(anything.test('Symbol.iterator')).toBe(true)
    expect(anything.test('.')).toBe(false)
    expect(anything.test('..')).toBe(false)
})

// THE REVERT: accept any statement list in `matcherOf`; each of these reads as a matcher.
test('a param file holding anything but its one regex literal is refused — 23.24', () => {
    const refused = (text: string, relative = TICKER): string =>
        (matcherOf(relative, text) as Error).message
    expect(
        refused("import x from './x.ts'\nexport const TICKER = /a/"),
    ).toContain('23.24')
    expect(refused('export const TICKER = "a"')).toContain('23.24')
    expect(refused('export const TICKER = new RegExp("a")')).toContain('23.24')
    expect(
        refused('export const TICKER = /a/\nexport const OTHER = /b/'),
    ).toContain('23.24')
    expect(refused('export const OTHER = /a/')).toContain('exports OTHER')
    expect(refused('export const TICKER = /a/i')).toContain('the flag i')
})

// THE REVERT: return `undefined` from `runawayIn`; `(a+)+` and `(\w)\1` read as matchers.
test('a matcher that can backtrack without bound is refused — 23.25', () => {
    expect(runawayIn('(a+)+')).toBe('a repetition of a group that repeats')
    expect(runawayIn('(?:a*b)*')).toBe('a repetition of a group that repeats')
    expect(runawayIn('((a+))+')).toBe('a repetition of a group that repeats')
    expect(runawayIn('(a+){2,}')).toBe('a repetition of a group that repeats')
    expect(runawayIn('(\\w)\\1')).toBe('a backreference')
    expect(runawayIn('(?<x>a)\\k<x>')).toBe('a backreference')
    // One repetition, a bounded one round another, and a class holding what reads as a group.
    expect(runawayIn('[A-Z0-9^=-]+(?:\\.[A-Z0-9]+)?')).toBeUndefined()
    expect(runawayIn('(a+){2}')).toBeUndefined()
    expect(runawayIn('[(+)]+')).toBeUndefined()
    expect(runawayIn('\\(a+\\)+')).toBeUndefined()
})
