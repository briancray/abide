// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the `${}` sequences below are the
// test DATA — this file exists to assert how the skipper treats them, including the case where a
// `$` sits inside a single/double-quoted string and is therefore NOT a substitution.

// The one string/template skipper. These assert the property the five hand-rolled copies disagreed on —
// that a template's `${…}` is understood — plus the plain cases every copy already got right, so the
// unification cannot regress them.

import { describe, expect, test } from 'bun:test'
import {
    matchingBracket,
    skipQuoted,
    splitParams,
    splitTopLevel,
    topLevelAssignmentIndex,
    topLevelIndexOf,
} from './scanText.ts'

// Returns the substring the skipper considers the whole string literal, which is what a caller acts on.
function span(text: string, openIndex = 0): string {
    return text.slice(openIndex, skipQuoted(text, openIndex) + 1)
}

describe('plain strings', () => {
    test.each([
        [`'abc'`, `'abc'`],
        [`"abc"`, `"abc"`],
        ['`abc`', '`abc`'],
    ])('%s spans the whole literal', (text, expected) => {
        expect(span(text)).toBe(expected)
    })

    test.each([[`'a\\'b'`], [`"a\\"b"`], ['`a\\`b`']])(
        'an escaped delimiter does not close it: %s',
        (text) => {
            expect(span(text)).toBe(text)
        },
    )

    test('a `$` in a NON-template is an ordinary character', () => {
        expect(span('"a${b}c"')).toBe('"a${b}c"')
    })

    test('an unterminated string yields the rest of the text rather than looping', () => {
        expect(skipQuoted(`'abc`, 0)).toBe(4)
    })

    test('a non-quote start index is returned unchanged', () => {
        expect(skipQuoted('abc', 0)).toBe(0)
    })
})

describe('template substitutions', () => {
    test('a simple `${}` is part of the literal', () => {
        expect(span('`a${b}c`')).toBe('`a${b}c`')
    })

    // The case every naive copy got wrong: the inner backtick is an OPENING delimiter, not the closer.
    // Getting this wrong truncated `emitCheck`'s generated TypeScript mid-expression.
    test('a NESTED template inside `${}` does not close the outer one', () => {
        expect(span('`a${`b`}c`')).toBe('`a${`b`}c`')
    })

    test('nested three deep', () => {
        const text = '`a${`b${`c`}d`}e`'
        expect(span(text)).toBe(text)
    })

    test('a comma inside a nested template is INSIDE the literal', () => {
        // The exact shape that split a declarator list in two and emitted unparseable TS.
        const text = '`a${`b,c`}d`'
        expect(span(text)).toBe(text)
    })

    test('braces inside a substitution are balanced, not taken as the end', () => {
        expect(span('`a${ {x:1} }b`')).toBe('`a${ {x:1} }b`')
    })

    test('a quote inside a substitution is skipped through', () => {
        expect(span('`a${ "}" }b`')).toBe('`a${ "}" }b`')
        expect(span("`a${ '}' }b`")).toBe("`a${ '}' }b`")
    })

    test('a delimiter after the literal is not consumed', () => {
        const text = '`a${`b,c`}d`, y = 1'
        expect(span(text)).toBe('`a${`b,c`}d`')
    })

    test('an unterminated substitution yields the rest rather than looping', () => {
        expect(skipQuoted('`a${b', 0)).toBe(5)
    })
})

// ---------------------------------------------------------------------------
// The splitters — the operations the six copies actually existed to perform, and where
// they diverged BY LANE (the check lane's skipped strings; the build lane's did not).
// ---------------------------------------------------------------------------

describe('splitParams', () => {
    test('a separator inside a string is not a split — the build-lane divergence', () => {
        // `splitParams` was the one consumer that never learned to skip strings, so this
        // returned three parts and bound `y` as a real declarator (ReferenceError at mount).
        expect(splitParams('a = "x,y", b = 1')).toEqual(['a = "x,y"', 'b = 1'])
        expect(splitParams("a = 'x,y', b = 1")).toEqual(["a = 'x,y'", 'b = 1'])
    })

    test('a separator inside a NESTED template substitution is not a split', () => {
        expect(splitParams('x = `a${`b,c`}d`, y = 1')).toEqual(['x = `a${`b,c`}d`', 'y = 1'])
    })

    test('a top-level comma in a type-argument list is not a split', () => {
        expect(splitParams('m: Map<K, V> = new Map()')).toEqual(['m: Map<K, V> = new Map()'])
        expect(splitParams('c = channel<T, Args>(), d = 1')).toEqual([
            'c = channel<T, Args>()',
            'd = 1',
        ])
    })

    test('brackets, braces and parens hold their commas', () => {
        expect(splitParams('{ a, b }, [c, d], f(g, h)')).toEqual(['{ a, b }', '[c, d]', 'f(g, h)'])
    })

    test('empty parts drop', () => {
        expect(splitParams('a, , b')).toEqual(['a', 'b'])
        expect(splitParams('')).toEqual([])
    })
})

describe('splitTopLevel', () => {
    test('parts carry the offset they start at, untrimmed', () => {
        expect(splitTopLevel('a, bb')).toEqual([
            { text: 'a', start: 0 },
            { text: ' bb', start: 2 },
        ])
    })

    test('splits on a separator other than a comma', () => {
        expect(splitTopLevel('a|b', '|').map((p) => p.text)).toEqual(['a', 'b'])
    })
})

describe('topLevelAssignmentIndex', () => {
    test('a function-type annotation splits at the real `=`, not the one inside `=>`', () => {
        const text = 'f: () => void = fn'
        expect(text.slice(0, topLevelAssignmentIndex(text)).trim()).toBe('f: () => void')
    })

    test.each(['a == b', 'a === b', 'a != b', 'a >= b', 'a <= b'])(
        'a comparison is not an assignment: %s',
        (text) => {
            expect(topLevelAssignmentIndex(text)).toBe(-1)
        },
    )

    test('an `=` inside a string is not an assignment', () => {
        expect(topLevelAssignmentIndex('"a=b"')).toBe(-1)
    })
})

describe('topLevelIndexOf', () => {
    test('a target inside a string or a nest is not found', () => {
        expect(topLevelIndexOf('"a=b"', '=')).toBe(-1)
        expect(topLevelIndexOf('{ a: 1 }', ':')).toBe(-1)
    })

    test('finds the first top-level occurrence', () => {
        expect(topLevelIndexOf('a: T = 1', ':')).toBe(1)
    })
})

describe('matchingBracket', () => {
    test('skips a bracket inside a string', () => {
        const text = '(a, ")" , b)'
        expect(matchingBracket(text, 0)).toBe(text.length - 1)
    })

    test('balances nested brackets', () => {
        expect(matchingBracket('({[x]})', 0)).toBe(6)
    })

    test('unbalanced yields -1', () => {
        expect(matchingBracket('(a', 0)).toBe(-1)
    })
})
