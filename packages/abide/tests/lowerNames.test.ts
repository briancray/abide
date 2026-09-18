import { expect, test } from 'bun:test'
import { lowerNames } from '#compiler/lowerNames.ts'

const N = new Set(['n'])

// 31.1 — a name bound to a `Reactive` is read wherever it stands.
test('a read by name becomes a call', () => {
    expect(lowerNames('n', N)).toBe('n()')
    expect(lowerNames('n + 1', N)).toBe('n() + 1')
    expect(lowerNames('n * n', N)).toBe('n() * n()')
    expect(lowerNames('f(n, 2)', N)).toBe('f(n(), 2)')
})

// 31.4 — assignment to such a name is a write.
test('an assignment becomes a write', () => {
    expect(lowerNames('n = 1', N)).toBe('n.set(1)')
    expect(lowerNames('n = n + 1', N)).toBe('n.set(n() + 1)')
    expect(lowerNames('() => n = n + 1', N)).toBe('() => n.set(n() + 1)')
    expect(lowerNames('n += 1', N)).toBe('n.set(n() + (1))')
    expect(lowerNames('n -= step', N)).toBe('n.set(n() - (step))')
})

// 31.7 — the explicit spelling keeps compiling, and is not rewritten twice.
test('an explicit read or write is left alone', () => {
    expect(lowerNames('n()', N)).toBe('n()')
    expect(lowerNames('n.set(2)', N)).toBe('n.set(2)')
    expect(lowerNames('n.peek()', N)).toBe('n.peek()')
})

// The cases a regex gets wrong, which is the whole reason the scanner is here. THE REVERT:
// replace `tokenise` with `source.replaceAll(/\bn\b/g, 'n()')`; this test then reports
// `'n is not a name'` rewritten to `'n() is not a name'` and `obj.n` to `obj.n()` — 3 wrong
// rewrites where 0 are due.
test('a string, a comment and a member are not the name', () => {
    expect(lowerNames("'n is not a name'", N)).toBe("'n is not a name'")
    expect(lowerNames('obj.n', N)).toBe('obj.n')
    // biome-ignore-start lint/suspicious/noTemplateCurlyInString: the slot IS the subject.
    expect(lowerNames('`n in a template ${n}`', N)).toBe(
        '`n in a template ${n()}`',
    )
    // biome-ignore-end lint/suspicious/noTemplateCurlyInString: the slot IS the subject.
    expect(lowerNames('other', N)).toBe('other')
    expect(lowerNames('notn + nn', N)).toBe('notn + nn')
})

test('a file with no reactive name is returned unchanged', () => {
    const source = 'a = b + c'
    expect(lowerNames(source, new Set())).toBe(source)
})

// The declaration BINDS the name, it does not write through it. THE REVERT: drop the
// `DECLARATION` check in `lowerNames`; this test then reports `let n = n.set(reactive(0))`
// where `let n = reactive(0)` is due — 1 destroyed binding, and every read after it throws.
test('a declaration is not a write', () => {
    expect(lowerNames('let n = reactive(0)', N)).toBe('let n = reactive(0)')
    expect(lowerNames('const n = reactive(0)', N)).toBe('const n = reactive(0)')
    expect(lowerNames('let n = reactive(0)\nn = 2', N)).toBe(
        'let n = reactive(0)\nn.set(2)',
    )
})

// AN IMPORT CLAUSE NAMES A BINDING, IT DOES NOT READ ONE. THE REVERT: drop the skipped-span pass
// in `lowerNames`; `import { n } from './x.ts'` lowers to `import { n() } from './x.ts'`, which
// is not valid in any grammar — the emitted module fails to parse and nothing about the compiler
// output says why.
test('an import clause is not rewritten', () => {
    expect(lowerNames("import { n } from './x.ts'", N)).toBe(
        "import { n } from './x.ts'",
    )
    expect(lowerNames("import n from './x.ts'", N)).toBe(
        "import n from './x.ts'",
    )
    expect(lowerNames("import { n as m } from './x.ts'", N)).toBe(
        "import { n as m } from './x.ts'",
    )
    // A DYNAMIC import is an expression, and a reactive name in its argument is a read.
    expect(lowerNames('import(n)', N)).toBe('import(n())')
    // And the statement after an import is lowered as usual.
    expect(lowerNames("import { x } from './x.ts'\nn = 1", N)).toBe(
        "import { x } from './x.ts'\nn.set(1)",
    )
})

// AN OBJECT SHORTHAND IS A KEY AND A VALUE, and only the value is a read. THE REVERT: drop the
// shorthand case in `lowerNames`; `{ n }` lowers to `{ n() }`, which is a method with no body, and
// the emitted module does not parse at all. Seven files in the example corpus hit this.
test('an object shorthand keeps its key', () => {
    expect(lowerNames('f({ n })', N)).toBe('f({ n: n() })')
    expect(lowerNames('f({ a, n })', N)).toBe('f({ a, n: n() })')
    expect(lowerNames('f({ n, a })', N)).toBe('f({ n: n(), a })')
    // An explicit key is already a value position and is lowered as one.
    expect(lowerNames('f({ k: n })', N)).toBe('f({ k: n() })')
    // A spread reads the whole value.
    expect(lowerNames('f({ ...n })', N)).toBe('f({ ...n() })')
})

// 31.14 — a destructuring pattern BINDS. THE REVERT: drop the pattern-skipping pass; `const { n }
// = x` lowers to `const { n: n() } = x`, which declares nothing and does not parse.
test('a destructuring pattern is not a read', () => {
    expect(lowerNames('const { n } = x', N)).toBe('const { n } = x')
    expect(lowerNames('const [n] = x', N)).toBe('const [n] = x')
    expect(lowerNames('const { a, n } = x', N)).toBe('const { a, n } = x')
    // And the read after it is still a read.
    expect(lowerNames('const { a } = x\nn + 1', N)).toBe(
        'const { a } = x\nn() + 1',
    )
})

// A TEMPLATE LITERAL'S TEXT IS TEXT. THE REVERT: drop the `reScanTemplateToken` handling in
// `tokenise`; the scanner reads the literal's tail as ordinary code, so a bare word in the TEXT is
// rewritten as a read and the closing backtick is lost — `${n} of n` lowered to `${n())} of n()`,
// which is not a program. One file in the corpus, and it would have been every file using a
// template.
test('a template literal only lowers its substitutions', () => {
    expect(lowerNames('`${n} and n`', N)).toBe('`${n()} and n`')
    expect(lowerNames('`n ${n} n`', N)).toBe('`n ${n()} n`')
    expect(lowerNames('`${n} ${n}`', N)).toBe('`${n()} ${n()}`')
    // An object inside a substitution still closes correctly.
    expect(lowerNames('`${f({ n })} tail n`', N)).toBe(
        '`${f({ n: n() })} tail n`',
    )
    expect(lowerNames('x = `a${n}b`', N)).toBe('x = `a${n()}b`')
})

// AN OBJECT KEY IS NOT A READ. THE REVERT: drop the key case; `{ n: 1 }` lowers to `{ n(): 1 }`.
test('an object key is not a read', () => {
    expect(lowerNames('f({ n: 1 })', N)).toBe('f({ n: 1 })')
    expect(lowerNames('f({ a: 1, n: 2 })', N)).toBe('f({ a: 1, n: 2 })')
    // A ternary's colon is not a key, and the name before it IS a read.
    expect(lowerNames('a ? n : b', N)).toBe('a ? n() : b')
})

// A PARAMETER IS A BINDING — the third position where that is true, after an import clause and a
// destructuring pattern. THE REVERT: drop the parameter-list pass; `function f(n)` lowers to
// `function f(n())` and `(n) => n` to `(n()) => n()`, neither of which is a program. Two files in
// the corpus, and every file that declares a handler taking a name the page also holds.
test('a parameter is not a read', () => {
    // The SIGNATURE is a binding list. The BODY is a separate question — see below.
    expect(lowerNames('function f(a, n) { return 1 }', N)).toBe(
        'function f(a, n) { return 1 }',
    )
    expect(lowerNames('const f = (n) => 1', N)).toBe('const f = (n) => 1')
    expect(lowerNames('const f = n => 1', N)).toBe('const f = n => 1')
    // A call is not a parameter list, and its argument IS a read.
    expect(lowerNames('f(n)', N)).toBe('f(n())')
    expect(lowerNames('f(n, 2)', N)).toBe('f(n(), 2)')
    // And an arrow that does not shadow still reads.
    expect(lowerNames('const f = (a) => n + a', N)).toBe(
        'const f = (a) => n() + a',
    )
})

// 31.12 — A BINDING SHADOWS THE NAME IT REUSES, for the body it is bound in. NOT IMPLEMENTED:
// `lowerNames` has no notion of scope, so a parameter named after a reactive value fixes the
// SIGNATURE and still lowers the BODY, where the name means the parameter.
//
// Asserted as it behaves TODAY so that implementing scope fails this test and forces it to be
// rewritten — the shape the slot-addressing dead end was found and fixed through. What it costs
// until then: a page naming a handler's parameter after one of its own values emits a call on
// something that is not a function, and finds out at run time.
test('a parameter shadowing a reactive name is NOT yet respected — 31.12', () => {
    expect(lowerNames('function f(n) { return n }', N)).toBe(
        'function f(n) { return n() }',
    )
    expect(lowerNames('const f = (n) => n + 1', N)).toBe(
        'const f = (n) => n() + 1',
    )
})

// A LINE BREAK ENDS A STATEMENT. THE REVERT: drop the line-break case in `rightHandSide`; a write
// with no semicolon after it swallows the next statement whole — `n = ''` followed by `return`
// lowers to `n.set('' return)`, which is not a program. One file in the corpus, whose author
// simply does not write semicolons, and it would be every such file.
test('a write ends at the line break, not at the next semicolon', () => {
    expect(lowerNames("n = ''\nreturn", N)).toBe("n.set('')\nreturn")
    expect(lowerNames('n = 1\nconst a = 2', N)).toBe('n.set(1)\nconst a = 2')
    expect(lowerNames('n = 1\nother()', N)).toBe('n.set(1)\nother()')
    // A value that plainly CONTINUES across the break is still one value.
    expect(lowerNames("n = 'a' +\n    'b'", N)).toBe("n.set('a' +\n    'b')")
    expect(lowerNames('n = a\n    .b', N)).toBe('n.set(a\n    .b)')
    // And a semicolon still ends it where there is one.
    expect(lowerNames('n = 1; other()', N)).toBe('n.set(1); other()')
})

// 31.5, 31.6 — A MEMBER REACHES THE VALUE unless the `Reactive` declares it. THE REVERT: skip
// every identifier followed by `.`, which is what this did before; `rows.join(', ')` then stays a
// call on the Reactive and reports `rows.join is not a function` at run time, with the page
// rendering up to that line and stopping.
test('a member reaches the value, and the API reaches the Reactive', () => {
    expect(lowerNames("n.join(', ')", N)).toBe("n().join(', ')")
    expect(lowerNames('n.length', N)).toBe('n().length')
    expect(lowerNames('n.map((x) => x)', N)).toBe('n().map((x) => x)')
    // The `Reactive`'s own members are the API and pass through untouched (31.7).
    expect(lowerNames('n.set(2)', N)).toBe('n.set(2)')
    expect(lowerNames('n.peek()', N)).toBe('n.peek()')
    expect(lowerNames('n.ready()', N)).toBe('n.ready()')
    expect(lowerNames('n.isError(e, "X")', N)).toBe('n.isError(e, "X")')
    // A member of something else is not ours either way.
    expect(lowerNames('obj.n.join()', N)).toBe('obj.n.join()')
})
