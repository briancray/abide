// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the `${}` sequences below are the
// test DATA — this file exists to assert how the skipper treats them, including the case where a
// `$` sits inside a single/double-quoted string and is therefore NOT a substitution.

// The one string/template skipper. These assert the property the five hand-rolled copies disagreed on —
// that a template's `${…}` is understood — plus the plain cases every copy already got right, so the
// unification cannot regress them.

import { describe, expect, test } from 'bun:test'
import { skipQuoted } from './skipQuoted.ts'

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
