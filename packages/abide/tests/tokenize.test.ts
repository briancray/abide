import { expect, test } from 'bun:test'

import { SyntaxKind } from 'typescript/unstable/ast'

import { parseAbide } from '#compiler/parseAbide.ts'
import { slotEnd, tokenize } from '#compiler/tokenize.ts'

// A `/` IS A LITERAL WHERE AN OPERAND IS EXPECTED AND A DIVISION WHERE ONE ENDED. Each case below
// is counted in regular expression literals: a division read as a literal turns `/ n /` into one,
// a literal read as a division leaves none — and the rest of its line as tokens.
const regexes = (source: string): number =>
    tokenize(source).filter(
        (token) => token.kind === SyntaxKind.RegularExpressionLiteral,
    ).length
const namesIn = (source: string, name: string): number =>
    tokenize(source).filter(
        (token) => token.kind === SyntaxKind.Identifier && token.text === name,
    ).length

// A `)` IS DECIDED BY ITS `(`: a condition's paren is followed by a statement. THE REVERT: push
// `OPERAND` for every `(`; `if (x) /re/` reports 0 literals where 1 is due — the case a one-token
// lookback had to accept as wrong.
test('a regex after the paren of a condition is a regex', () => {
    expect(regexes('if (x) /re/.test(s)')).toBe(1)
    expect(regexes('while (x) /re/.test(s)')).toBe(1)
    expect(regexes('for (const s of xs) /re/.test(s)')).toBe(1)
    expect(regexes('if (x) /=/.test(s)')).toBe(1)
    // And every other `)` ends a value.
    expect(regexes('(a) / n / 2')).toBe(0)
    expect(regexes('f(a) / n / 2')).toBe(0)
    expect(regexes('x /= n / 2')).toBe(0)
    // `if` after a `.` is a member name, and its call is a value.
    expect(regexes('x.if(a) / n / 2')).toBe(0)
})

// A `}` IS DECIDED BY ITS `{`: a block is followed by a statement, an object literal ends a value.
// THE REVERT: tag every `{` `STATEMENT`; `x = { a: 1 } / n / 2` reports 1 literal where 0 is due.
// And tag every `{` `OPERAND`; the block before `/re/` reports 0 where 1 is due.
test('a regex after a block is a regex and a division after an object divides', () => {
    expect(regexes('{ a }\n/re/.test(s)')).toBe(1)
    expect(regexes('function clean(s) { return s }\n/[\'"]/.test(q)')).toBe(1)
    expect(regexes('function f(): void {}\n/re/.test(s)')).toBe(1)
    expect(regexes('function f(): Promise<T> {}\n/re/.test(s)')).toBe(1)
    expect(regexes('({}) / n / 2')).toBe(0)
    expect(regexes('x = { a: 1 } / n / 2')).toBe(0)
    expect(regexes('f(a, { a: 1 } / n / 2)')).toBe(0)
})

// A KEYWORD AFTER A `.` IS A MEMBER NAME. THE REVERT: drop the `.` test that reads it as an
// `Identifier`; `x.return / n / 2` reports 1 literal where 0 is due, and so does `x.if(a)` above.
test('a division after a member named like a keyword divides', () => {
    expect(regexes('x.return / n / 2')).toBe(0)
    expect(regexes('row.type / n / 2')).toBe(0)
    expect(regexes('obj.in / n / 2')).toBe(0)
    expect(regexes('a?.typeof / n / 2')).toBe(0)
})

// A CONTEXTUAL KEYWORD IS A NAME, except `await` and `of`, which take an operand. THE REVERT: make
// `endsOperand` answer false for the whole contextual range; `type / n / 2` reports 1 literal where
// 0 is due. Answer true for all of it, and `await /re/` reports 0 where 1 is due.
test('a contextual keyword divides as a name unless it takes an operand', () => {
    expect(regexes('type / n / 2')).toBe(0)
    expect(regexes('get / n / 2')).toBe(0)
    expect(regexes('await /re/.test(s)')).toBe(1)
    expect(regexes('for (const m of /re/.exec(s)) m')).toBe(1)
})

// A `!` OR `++` LEAVES THE QUESTION WHERE IT WAS: prefix before an operand, postfix after one.
// THE REVERT: let the `!` fall to `default` (an operand expected after it, the prefix reading);
// `count! / n / 2` reports 1 literal where 0 is due. The regex after a prefix `!` is the other half.
test('a prefix bang opens a regex and a postfix bang divides', () => {
    expect(regexes('!/re/.test(s)')).toBe(1)
    expect(regexes('x = !/re/.test(s)')).toBe(1)
    expect(regexes('count! / n / 2')).toBe(0)
    expect(regexes('count++ / n / 2')).toBe(0)
})

// A TEMPLATE LITERAL'S SUBSTITUTION IS CODE AND ITS TEXT IS NOT, and only the `}` the `${` opened
// continues the text. THE REVERT: re-scan every `}` inside a template as its continuation; the
// object literal's own `}` ends the substitution there and the code after it becomes text — the
// read of `n` in the substitution is lost, 0 names where 1 is due.
test('a template literal with nested braces', () => {
    expect(namesIn('`${ f({ a: { b: 1 } }) } n`', 'n')).toBe(0)
    expect(namesIn('`${ { a: 1 }.a + n } n`', 'n')).toBe(1)
    expect(regexes('`${ { a: 1 }.a / n / 2 }`')).toBe(0)
    expect(regexes('`${ `${ x }` / n / 2 }`')).toBe(0)
    expect(regexes('`${x}` / n / 2')).toBe(0)
    expect(regexes('`a${ /}/.test(s) }b`')).toBe(1)
})

// A SLOT'S END IS THE SAME SCAN, so a literal after a condition no longer runs past it. THE
// REVERT: push `OPERAND` for every `(`; the `/` reads as a division, the `}` inside the literal
// closes the slot, and the end comes back at 30 where 35 is due.
test('a slot with a regex after a condition ends at its own brace', () => {
    const source = '{ (() => { if (x) /}/.test(s) })() }'
    expect(slotEnd(source, 0)).toBe(source.length - 1)
})

// HTML's ASCII WHITESPACE INCLUDES FORM FEED. THE REVERT: drop `\f` from `isSpace`; `</style\f>`
// matches no close tag, the rest of the document becomes the style body, and the template comes
// back with 0 elements where 1 is due. And the close directive `{\f/if\f}` is scanned as a
// regular expression instead, ending at the source's length.
test('a form feed is whitespace in template grammar', () => {
    const file = parseAbide('<style>p {}</style\f><p>x</p>')
    expect(file.template).toHaveLength(1)
    expect(slotEnd('{\f/if\f}', 0)).toBe(6)
    expect(parseAbide('<p\fclass="a">x</p>').template[0]).toMatchObject({
        tag: 'p',
    })
})

// EVERY CLOSE DIRECTIVE IS TEMPLATE GRAMMAR, not only the two a list once named. `{/try}` inside an
// element was scanned as a regular expression running on to the `/` of `</div>`, and the markup
// after it compiled as the slot's expression. THE REVERT: recognize `/if` and `/for` alone — the
// slot below ends at 12, the source's length, where 5 is due.
test('a {/try} inside an element closes the block rather than opening a regular expression', () => {
    expect(slotEnd('{/try}</div>', 0)).toBe(5)
    const file = parseAbide(
        '<div>{#try}<b>{x}</b>{:catch problem}<p>{count}</p>{/try}</div>',
    )
    expect(file.template).toHaveLength(1)
    expect(file.template[0]).toMatchObject({
        tag: 'div',
        children: [{ kind: 'block', block: 'try' }],
    })
})

// A BLOCK'S DIRECTIVE TAKES AN OPERAND. `#if` scans as a private name, which ends an operand, so a
// regular expression opening the condition read as a division — and a quote or a brace inside it
// ran the slot on past its own `}`.
//
// THE REVERT: drop `slotEnd`'s skip of the directive's `#name`. The first slot below ends at 50, the
// source's length, where 16 is due; the second at 33 where 18 is due; and each parse puts 1
// top-level node where 2 are.
test('a regular expression opening a block condition is a literal', () => {
    const quoted = `{#if /'/.test(s)}<p>yes</p>{/if}<footer>f</footer>`
    const braced = `{#if /[{]/.test(s)}<p>yes</p>{/if}<footer>f</footer>`
    expect([slotEnd(quoted, 0), slotEnd(braced, 0)]).toEqual([16, 18])
    expect(parseAbide(quoted).template).toHaveLength(2)
    expect(parseAbide(braced).template).toHaveLength(2)
})
