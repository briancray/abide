import { afterAll, expect, test } from 'bun:test'
import { SyntaxKind } from 'typescript/unstable/ast'
import { emitComponent } from '#compiler'
import { REACTIVE_MEMBERS } from '#compiler/REACTIVE_MEMBERS.ts'
import { tokenise } from '#compiler/tokenise.ts'
import { reactive } from '#shared'
import { closeTyped, lower, refusal, typed } from './typed.ts'

afterAll(closeTyped)

const N = new Set(['n'])

// WHAT `tokenise` MADE OF A SOURCE. The lowering reads the checker's tree, so a lowered string
// cannot see a mis-scan any more — but `splitImports`, a slot's end and `raw` still walk these
// tokens, so the scan is asserted where it is made.
const regexes = (source: string): number =>
    tokenise(source).filter(
        (token) => token.kind === SyntaxKind.RegularExpressionLiteral,
    ).length
const namesIn = (source: string, name: string): number =>
    tokenise(source).filter(
        (token) => token.kind === SyntaxKind.Identifier && token.text === name,
    ).length

// 31.1 — a name bound to a `Reactive` is read wherever it stands.
test('a read by name becomes a call', async () => {
    expect(await lower('n', N)).toBe('n()')
    expect(await lower('n + 1', N)).toBe('n() + 1')
    expect(await lower('n * n', N)).toBe('n() * n()')
    expect(await lower('f(n, 2)', N)).toBe('f(n(), 2)')
})

// 31.4 — assignment to such a name is a write.
test('an assignment becomes a write', async () => {
    expect(await lower('n = 1', N)).toBe('n.set(1)')
    expect(await lower('n = n + 1', N)).toBe('n.set(n() + 1)')
    expect(await lower('() => n = n + 1', N)).toBe('() => n.set(n() + 1)')
    expect(await lower('n += 1', N)).toBe('n.set(n() + (1))')
    expect(await lower('n -= step', N)).toBe('n.set(n() - (step))')
})

// 31.7 — the explicit spelling keeps compiling, and is not rewritten twice.
test('an explicit read or write is left alone', async () => {
    expect(await lower('n()', N)).toBe('n()')
    expect(await lower('n.set(2)', N)).toBe('n.set(2)')
    expect(await lower('n.peek()', N)).toBe('n.peek()')
})

// The cases a regex gets wrong, which is the whole reason the checker is asked. THE REVERT:
// replace the splice with `source.replaceAll(/\bn\b/g, 'n()')`; this test then reports
// `'n is not a name'` rewritten to `'n() is not a name'` and `obj.n` to `obj.n()` — 3 wrong
// rewrites where 0 are due.
test('a string, a comment and a member are not the name', async () => {
    expect(await lower("'n is not a name'", N)).toBe("'n is not a name'")
    expect(await lower('obj.n', N)).toBe('obj.n')
    // biome-ignore-start lint/suspicious/noTemplateCurlyInString: the slot IS the subject.
    expect(await lower('`n in a template ${n}`', N)).toBe(
        '`n in a template ${n()}`',
    )
    // biome-ignore-end lint/suspicious/noTemplateCurlyInString: the slot IS the subject.
    expect(await lower('other', N)).toBe('other')
    expect(await lower('notn + nn', N)).toBe('notn + nn')
})

test('a file with no reactive name is returned unchanged', async () => {
    const source = 'a = b + c'
    expect(await lower(source, new Set())).toBe(source)
})

// The declaration BINDS the name, it does not write through it. THE REVERT: drop the
// `VariableDeclaration` case from `classifyRead`; the declaration's name is then a read and this
// reports `let n() = reactive(0)` — a module that does not parse.
test('a declaration is not a write', async () => {
    expect(await lower('let n = reactive(0)', N)).toBe('let n = reactive(0)')
    expect(await lower('const n = reactive(0)', N)).toBe(
        'const n = reactive(0)',
    )
    expect(await lower('let n = reactive(0)\nn = 2', N)).toBe(
        'let n = reactive(0)\nn.set(2)',
    )
})

// AN IMPORT CLAUSE NAMES A BINDING, IT DOES NOT READ ONE. THE REVERT: drop the specifier cases
// from `classifyRead`; `import { n } from './x.ts'` lowers to `import { n() } from './x.ts'`, which
// is not valid in any grammar — the emitted module fails to parse and nothing about the compiler
// output says why.
test('an import clause is not rewritten', async () => {
    expect(await lower("import { n } from './x.ts'", N)).toBe(
        "import { n } from './x.ts'",
    )
    expect(await lower("import n from './x.ts'", N)).toBe(
        "import n from './x.ts'",
    )
    expect(await lower("import { n as m } from './x.ts'", N)).toBe(
        "import { n as m } from './x.ts'",
    )
    // A DYNAMIC import is an expression, and a reactive name in its argument is a read.
    expect(await lower('import(n)', N)).toBe('import(n())')
    // And the statement after an import is lowered as usual.
    expect(await lower("import { x } from './x.ts'\nn = 1", N)).toBe(
        "import { x } from './x.ts'\nn.set(1)",
    )
})

// AN OBJECT SHORTHAND IS A KEY AND A VALUE, and only the value is a read. THE REVERT: drop the
// shorthand case in `classifyRead`; `{ n }` lowers to `{ n() }`, which is a method with no body, and
// the emitted module does not parse at all. Seven files in the example corpus hit this.
test('an object shorthand keeps its key', async () => {
    expect(await lower('f({ n })', N)).toBe('f({ n: n() })')
    expect(await lower('f({ a, n })', N)).toBe('f({ a, n: n() })')
    expect(await lower('f({ n, a })', N)).toBe('f({ n: n(), a })')
    // An explicit key is already a value position and is lowered as one.
    expect(await lower('f({ k: n })', N)).toBe('f({ k: n() })')
    // A spread reads the whole value.
    expect(await lower('f({ ...n })', N)).toBe('f({ ...n() })')
})

// 31.12 — a destructuring pattern BINDS. THE REVERT: take reads by SPELLING rather than the
// checker's references; `const { n } = x` lowers to `const { n: n() } = x`, which declares nothing and does not parse.
test('a destructuring pattern is not a read', async () => {
    expect(await lower('const { n } = x', N)).toBe('const { n } = x')
    expect(await lower('const [n] = x', N)).toBe('const [n] = x')
    expect(await lower('const { a, n } = x', N)).toBe('const { a, n } = x')
    // And the read after it is still a read.
    expect(await lower('const { a } = x\nn + 1', N)).toBe(
        'const { a } = x\nn() + 1',
    )
})

// A TEMPLATE LITERAL'S TEXT IS TEXT. THE REVERT: drop the `reScanTemplateToken` handling in
// `tokenise`; the scanner reads the literal's tail as ordinary code, and the second word below
// scans as a name — 2 where 1 is due.
test('a template literal only lowers its substitutions', async () => {
    expect(namesIn('`${n} and n`', 'n')).toBe(1)
    expect(await lower('`${n} and n`', N)).toBe('`${n()} and n`')
    expect(await lower('`n ${n} n`', N)).toBe('`n ${n()} n`')
    expect(await lower('`${n} ${n}`', N)).toBe('`${n()} ${n()}`')
    // An object inside a substitution still closes correctly.
    expect(await lower('`${f({ n })} tail n`', N)).toBe(
        '`${f({ n: n() })} tail n`',
    )
    expect(await lower('x = `a${n}b`', N)).toBe('x = `a${n()}b`')
})

// AN OBJECT KEY IS NOT A READ. THE REVERT: take reads by SPELLING rather than the
// checker's references; `{ n: 1 }` lowers to `{ n(): 1 }`.
test('an object key is not a read', async () => {
    expect(await lower('f({ n: 1 })', N)).toBe('f({ n: 1 })')
    expect(await lower('f({ a: 1, n: 2 })', N)).toBe('f({ a: 1, n: 2 })')
    // A ternary's colon is not a key, and the name before it IS a read.
    expect(await lower('a ? n : b', N)).toBe('a ? n() : b')
})

// A PARAMETER IS A BINDING — the third position where that is true, after an import clause and a
// destructuring pattern. THE REVERT: take reads by SPELLING; `function f(n)` lowers to
// `function f(n())` and `(n) => n` to `(n()) => n()`, neither of which is a program. Two files in
// the corpus, and every file that declares a handler taking a name the page also holds.
test('a parameter is not a read', async () => {
    // The SIGNATURE is a binding list. The BODY is a separate question — see below.
    expect(await lower('function f(a, n) { return 1 }', N)).toBe(
        'function f(a, n) { return 1 }',
    )
    expect(await lower('const f = (n) => 1', N)).toBe('const f = (n) => 1')
    expect(await lower('const f = n => 1', N)).toBe('const f = n => 1')
    // A call is not a parameter list, and its argument IS a read.
    expect(await lower('f(n)', N)).toBe('f(n())')
    expect(await lower('f(n, 2)', N)).toBe('f(n(), 2)')
    // And an arrow that does not shadow still reads.
    expect(await lower('const f = (a) => n + a', N)).toBe(
        'const f = (a) => n() + a',
    )
})

// 31.3 — A NAME HOLDS THE `Reactive` ONLY WHERE THE DECLARED TYPE OF ITS POSITION IS ONE, and a
// name re-bound by a function, a block, a loop or a catch is a different position. THE REVERT:
// take reads by SPELLING — every identifier whose text is a reactive name — rather than the references `TypeSession.readsFor` asks the checker for; every body below lowers its own binding as a read — 11 wrong rewrites where 0 are
// due, each of them `n is not a function` on the first run.
test('a binding shadows the page value for the body it is bound in — 31.3', async () => {
    expect(await lower('function f(n) { return n }', N)).toBe(
        'function f(n) { return n }',
    )
    expect(await lower('const f = (n) => n + 1', N)).toBe(
        'const f = (n) => n + 1',
    )
    expect(await lower('const f = n => n + 1', N)).toBe('const f = n => n + 1')
    // A RETURN TYPE ANNOTATION STANDS BETWEEN THE PARAMETERS AND THE BODY, and the pass that
    // looked for a `{` or an `=>` directly after the `)` did not see past one — so an annotated
    // signature lowered its own parameter list, `function f(n): string` emitting `f(n())`.
    expect(await lower('function f(n): string { return n }', N)).toBe(
        'function f(n): string { return n }',
    )
    expect(await lower('const f = (n): number => n', N)).toBe(
        'const f = (n): number => n',
    )
    expect(
        await lower(
            "function label(): string { const n = 'inner'; return n.toUpperCase() }",
            N,
        ),
    ).toBe(
        "function label(): string { const n = 'inner'; return n.toUpperCase() }",
    )
    expect(await lower('{ let n = 2; use(n) }', N)).toBe(
        '{ let n = 2; use(n) }',
    )
    expect(await lower('for (const n of xs) use(n)', N)).toBe(
        'for (const n of xs) use(n)',
    )
    expect(await lower('try { x() } catch (n) { log(n) }', N)).toBe(
        'try { x() } catch (n) { log(n) }',
    )
    // THE SHADOW ENDS WHERE THE BODY DOES. A scope that ran to the end of the file would take
    // the page's own reads with it, and that failure is the silent one: the `Reactive` itself
    // rendered where its value was due.
    expect(await lower('const f = (n) => n\nconst total = n + 1', N)).toBe(
        'const f = (n) => n\nconst total = n() + 1',
    )
    expect(await lower('{ let n = 2; use(n) }\nn = 3', N)).toBe(
        '{ let n = 2; use(n) }\nn.set(3)',
    )
})

// 31.3 — THE POSITIONS THAT HOLD THE `Reactive`: a parameter DECLARED as one, an annotated binding
// and an annotated return. The declared type is the one written at the declaration, so a generic
// `T` that would INFER to a `Reactive` from this very argument is not one — `structuredClone(n)`
// snapshots. And a union is `Reactive`-typed only where every member is: `s.set` also takes a
// plain value, so `m.set(n)` still reads. THE REVERT: drop the `holding` pass in
// `TypeSession.readsFor`; the first five lower to a read — 5 wrong rewrites, and `watch` is
// handed a string where it walks a source's readers.
test('a position declared as a Reactive holds the Reactive — 31.3', async () => {
    const NM = new Set(['n', 'm'])
    const watching = "import { watch } from 'abide'\n"
    expect(await lower(`${watching}watch([n], () => {})`, NM)).toBe(
        `${watching}watch([n], () => {})`,
    )
    expect(await lower(`${watching}watch([n, m], () => {})`, NM)).toBe(
        `${watching}watch([n, m], () => {})`,
    )
    expect(await lower(`${watching}watch(n, () => {})`, NM)).toBe(
        `${watching}watch(n, () => {})`,
    )
    expect(await lower("const r: import('abide').Reactive<any> = n", NM)).toBe(
        "const r: import('abide').Reactive<any> = n",
    )
    expect(
        await lower(
            "function f(): import('abide').Reactive<any> { return n }",
            NM,
        ),
    ).toBe("function f(): import('abide').Reactive<any> { return n }")
    expect(await lower('structuredClone(n)', NM)).toBe('structuredClone(n())')
    expect(await lower('m.set(n)', NM)).toBe('m.set(n())')
    expect(await lower('const r: number = n', NM)).toBe('const r: number = n()')
})

// THE RIGHT OF A WRITE IS LOWERED AS A SPAN OF THE SAME TOKENS, because a substring does not carry
// the scope it was cut from. THE REVERT: lower the value with `await lower(substring, reactive)` in
// the assignment branch; the parameter below is lowered as a read inside the value — 1 wrong
// rewrite, `g.set(n() + 1)` where the page's `n` is not what `n` means there.
test('a value lowered by recursion keeps the shadow it stands in', async () => {
    const NG = new Set(['n', 'g'])
    expect(await lower('function f(n) { g = n + 1 }', NG)).toBe(
        'function f(n) { g.set(n + 1) }',
    )
    expect(await lower('function f(n) { g.a = n }', NG)).toBe(
        'function f(n) { g.set(__writePath(g(), ["a"], n)) }',
    )
})

// A NAME CAN STAND WHERE NO VALUE IS READ AT ALL. THE REVERT: take reads by SPELLING — every identifier whose text is a reactive name — rather than the references `TypeSession.readsFor` asks the checker for; the label and the
// class field lower to `n(): while … break n()` and `class C { n.set(1) }` — 2 modules that do
// not parse.
test('a label, a class member and a declared name are not reads', async () => {
    expect(await lower('n: while (x) { break n }', N)).toBe(
        'n: while (x) { break n }',
    )
    expect(await lower('class C { n = 1; m() { return this.n } }', N)).toBe(
        'class C { n = 1; m() { return this.n } }',
    )
    expect(await lower('for (let n = 0; n < 3; n++) use(n)', N)).toBe(
        'for (let n = 0; n < 3; n++) use(n)',
    )
    expect(await lower('function n() { return 1 }', N)).toBe(
        'function n() { return 1 }',
    )
    expect(await lower('function f(n: Row[]) { return 1 }', N)).toBe(
        'function f(n: Row[]) { return 1 }',
    )
    // A class member's INITIALIZER is still a read, and only a line break tells the two apart.
    expect(await lower('class C {\n  a =\n    n\n}', N)).toBe(
        'class C {\n  a =\n    n()\n}',
    )
})

// A LINE BREAK ENDS A STATEMENT. THE REVERT: run a write's value in `classifyRead` to the end of
// its span rather than to the assignment's right operand; a write with no semicolon after it swallows the next statement whole — `n = ''` followed by `return`
// lowers to `n.set('' return)`, which is not a program. One file in the corpus, whose author
// simply does not write semicolons, and it would be every such file.
test('a write ends at the line break, not at the next semicolon', async () => {
    expect(await lower("n = ''\nreturn", N)).toBe("n.set('')\nreturn")
    expect(await lower('n = 1\nconst a = 2', N)).toBe('n.set(1)\nconst a = 2')
    expect(await lower('n = 1\nother()', N)).toBe('n.set(1)\nother()')
    // A value that plainly CONTINUES across the break is still one value.
    expect(await lower("n = 'a' +\n    'b'", N)).toBe("n.set('a' +\n    'b')")
    expect(await lower('n = a\n    .b', N)).toBe('n.set(a\n    .b)')
    // And a semicolon still ends it where there is one.
    expect(await lower('n = 1; other()', N)).toBe('n.set(1); other()')
})

// 31.5, 31.6 — A MEMBER REACHES THE VALUE unless the `Reactive` declares it. THE REVERT: skip
// every identifier followed by `.`, which is what this did before; `rows.join(', ')` then stays a
// call on the Reactive and reports `rows.join is not a function` at run time, with the page
// rendering up to that line and stopping.
test('a member reaches the value, and the API reaches the Reactive', async () => {
    expect(await lower("n.join(', ')", N)).toBe("n().join(', ')")
    expect(await lower('n.length', N)).toBe('n().length')
    expect(await lower('n.map((x) => x)', N)).toBe('n().map((x) => x)')
    // The `Reactive`'s own members are the API and pass through untouched (31.7).
    expect(await lower('n.set(2)', N)).toBe('n.set(2)')
    expect(await lower('n.peek()', N)).toBe('n.peek()')
    expect(await lower('n.ready()', N)).toBe('n.ready()')
    expect(await lower('n.isError(e, "X")', N)).toBe('n.isError(e, "X")')
    // A member of something else is not ours either way.
    expect(await lower('obj.n.join()', N)).toBe('obj.n.join()')
})

// AN OPERATOR AT THE START OF ITS LINE CONTINUES THE VALUE, and getting this wrong fails SILENTLY
// rather than loudly: cut at the break, `n = a\n && b` emits `n.set(a)\n && b`, which is still a
// program — `n.set(a) && b` — and stores `a`. THE REVERT: end a write's value at the first
// line break rather than at the assignment's right operand; every one of these stores the left
// operand and drops the rest.
test('a leading operator continues the value across a line break', async () => {
    expect(await lower('n = a\n    && b', N)).toBe('n.set(a\n    && b)')
    expect(await lower('n = a\n    || b', N)).toBe('n.set(a\n    || b)')
    expect(await lower('n = a\n    ?? b', N)).toBe('n.set(a\n    ?? b)')
    expect(await lower('n = a\n    + b', N)).toBe('n.set(a\n    + b)')
    expect(await lower('n = a\n    === b', N)).toBe('n.set(a\n    === b)')
    // `++` and `--` are the restricted productions: a break before one DOES end the statement.
    expect(await lower('n = a\n++b', N)).toBe('n.set(a)\n++b')
})

// A VALUE CAN END ON A KEYWORD, and where it ends is the checker's syntax tree: a write's value is
// the assignment's right operand. A hand-written token walk missed the type keywords and `!` once,
// and `n = x as string` with no semicolon swallowed the line after it.
test('a cast or a non-null assertion still ends at the line break', async () => {
    expect(await lower('n = x as string\nother()', N)).toBe(
        'n.set(x as string)\nother()',
    )
    expect(await lower('n = x as const\nother()', N)).toBe(
        'n.set(x as const)\nother()',
    )
    expect(await lower('n = x!\nother()', N)).toBe('n.set(x!)\nother()')
    // TypeScript ends an expression at a line break before `as`, so the value is `x` alone.
    expect(await lower('n = x\n    as string\nother()', N)).toBe(
        'n.set(x)\n    as string\nother()',
    )
})

// 31.5 — THE LIST IS WHAT THE `Reactive` DECLARES, and a name that is not on it must not be there.
// THE REVERT: put `value` or `args` back in `REACTIVE_MEMBERS`; a value holding `{ value }` — an
// option row, a form field, a JSON payload — then reads `undefined` off the Reactive itself, with
// nothing thrown and nothing logged.
test('a member the Reactive does not declare reaches the value', async () => {
    expect(await lower('n.value', N)).toBe('n().value')
    expect(await lower('n.args', N)).toBe('n().args')
    expect(await lower('n.entries', N)).toBe('n().entries')
})

// 31.5 — AND EVERY NAME THE `Reactive` DOES DECLARE IS THERE. The compiler may not import the
// runtime, so the list is a copy; this is what holds the copy to the prototype `reactive()`
// installs. THE REVERT: add a member to `MEMBERS` in `Reactive.ts` and not here; `n.thatMember`
// then lowers to `n().thatMember` and reads the value's own property, which is `undefined`.
test('the member list is exactly what a Reactive carries', () => {
    const carried = Object.getOwnPropertyNames(
        Object.getPrototypeOf(reactive(0)),
    ).filter((name) => name !== 'constructor')
    expect(new Set(carried)).toEqual(new Set(REACTIVE_MEMBERS))
})

// A COMMA LIST IS NOT AN OBJECT LITERAL, and nothing next to the name can tell them apart: a comma
// before and a comma after is `{ a, n, b }` and it is equally `f(a, n, b)` and `[1, n, 2]`. THE
// REVERT: classify a read as a shorthand by the commas around it rather than by its
// `ShorthandPropertyAssignment` parent; the first two below lower to
// `f(a, n: n(), b)` and `[1, n: n(), 2]` — 2 keys written where the grammar takes none, and
// neither module parses.
test('a shorthand is told from a comma list by its bracket', async () => {
    expect(await lower('f(a, n, b)', N)).toBe('f(a, n(), b)')
    expect(await lower('const xs = [1, n, 2]', N)).toBe(
        'const xs = [1, n(), 2]',
    )
    expect(await lower('f(a, [n], b)', N)).toBe('f(a, [n()], b)')
    // And the shorthand it was written for still keeps its key.
    expect(await lower('f({ a, n, b })', N)).toBe('f({ a, n: n(), b })')
    // A brace that opens a BLOCK is not a literal either, and a read there is just a read.
    expect(await lower('function f() { n }', N)).toBe('function f() { n() }')
})

// `import.meta` IS AN EXPRESSION, NOT A DECLARATION. STRUCTURAL
// HERE, since the checker's tree holds each statement whole: what this caught was a skipped
// span running from `import` to the next string literal in the FILE, leaving `n = 1` inside it
// as written — a plain assignment over the binding, destroying the `Reactive` silently.
test('import.meta does not swallow the statements after it', async () => {
    expect(
        await lower("const u = import.meta.url\nn = 1\nconst label = 'x'", N),
    ).toBe("const u = import.meta.url\nn.set(1)\nconst label = 'x'")
    // An import with ATTRIBUTES is skipped whole — the keys in the clause are keys, not reads.
    expect(
        await lower("import d from './d.json' with { type: 'json' }\nn = 1", N),
    ).toBe("import d from './d.json' with { type: 'json' }\nn.set(1)")
})

// A `/` IS A REGEX OR A DIVISION AND THE SCANNER ANSWERS `SlashToken` FOR BOTH, so the scan
// was believed to produce a `RegularExpressionLiteral` and never did. THE REVERT: drop the
// `reScanSlashToken` call in `tokenise`; the pattern below is scanned as ordinary tokens — 0
// literals where 1 is due — and the `)` inside `[)]` feeds any depth count a bracket that was
// never one.
test('a regular expression literal is not tokens', async () => {
    expect(regexes('x.replace(/[)]/g, "")')).toBe(1)
    expect(regexes('a / b')).toBe(0)
    expect(await lower('const re = /n/g', N)).toBe('const re = /n/g')
    expect(await lower('n = x.replace(/[)]/g, "")', N)).toBe(
        'n.set(x.replace(/[)]/g, ""))',
    )
    expect(await lower('const ok = /^n$/.test(s)', N)).toBe(
        'const ok = /^n$/.test(s)',
    )
    // And a DIVISION is still a division: a `/` after something that ends an operand.
    expect(await lower('n = a / b', N)).toBe('n.set(a / b)')
})

// 31.8 — A WRITE THROUGH A MEMBER PATH COPIES DOWN THE PATH AND THEN WRITES. THE REVERT: delete
// the path walk in `classifyRead`, so the member READ takes the write.
// This test then reports `user().name = 'x'` where `user.set(__writePath(…))` is due — 4 writes
// that mutate the held object instead of minting one: the right value, no `set` called, the
// identity unchanged, and not one reader awake.
test('a write through a member path copies down the path', async () => {
    const U = new Set(['user', 'rows'])
    expect(await lower("user.name = 'x'", U)).toBe(
        'user.set(__writePath(user(), ["name"], \'x\'))',
    )
    expect(await lower('user.a.b = v', U)).toBe(
        'user.set(__writePath(user(), ["a", "b"], v))',
    )
    // A COMPUTED SEGMENT IS AN EXPRESSION AND MAY ITSELF BE A READ.
    expect(await lower('rows[0] = 1', U)).toBe(
        'rows.set(__writePath(rows(), [0], 1))',
    )
    expect(await lower('rows[user] = 1', U)).toBe(
        'rows.set(__writePath(rows(), [user()], 1))',
    )
    // An op-assign through a path READS the path first, the way `n += 1` reads `n`.
    expect(await lower('user.count += 1', U)).toBe(
        'user.set(__writePath(user(), ["count"], user()["count"] + (1)))',
    )
    // THE IMPORT GOES WITH THE CALL. A module emitting `__writePath` and not importing it is a
    // ReferenceError on the first write.
    const used = new Set<string>()
    await lower("user.name = 'x'", U, used)
    expect([...used]).toEqual(['writePath'])
})

// A READ THROUGH A MEMBER PATH IS STILL A READ, which is the half the path walk must not take.
test('a member path that is not assigned is left to the read paths', async () => {
    const U = new Set(['user', 'rows'])
    expect(await lower('user.name', U)).toBe('user().name')
    expect(await lower('rows[0]', U)).toBe('rows()[0]')
    expect(await lower('user.a.b(1)', U)).toBe('user().a.b(1)')
    // 31.5 — the FIRST segment being a `Reactive` member is the API, never a path.
    expect(await lower('user.set = f', U)).toBe('user.set = f')
    expect(await lower('user.set(2)', U)).toBe('user.set(2)')
    // `==` is not `=`.
    expect(await lower('user.name == 1', U)).toBe('user().name == 1')
})

// 31.11 — `foo()` TAKES NO ARGUMENTS. THE REVERT: drop the `arguments` check from
// `Lowering`'s `call` case; `count(5)` is then passed through as written and calls the read with a
// value the read ignores — 3 silent no-ops where 3 compile errors are due, and an author who
// wrote a write is given a read.
test('an argument to a read by name is a compile error', async () => {
    expect(await refusal(lower('n(5)', N))).toContain('31.11')
    expect(await refusal(lower('n(x)', N))).toContain('31.11')
    expect(await refusal(lower('const v = n(a, b)', N))).toContain('31.11')
    // And the empty call is 31.7's explicit read, untouched.
    expect(await lower('n()', N)).toBe('n()')
    expect(await lower('n( )', N)).toBe('n( )')
})

// 31.4 — THE SIXTEEN ASSIGNMENT OPERATORS ARE ONE MECHANISM, and a hand-written table of them
// went short at six. THE REVERT: test the six operators that table held in place of the
// `FirstAssignment`..`LastAssignment` range in `classifyRead`; the others below lower to
// `n() <op>= 1`, which is not a program in any grammar.
test('every assignment operator is a write — 31.4', async () => {
    expect(await lower('n = 1', N)).toBe('n.set(1)')
    expect(await lower('n += 1', N)).toBe('n.set(n() + (1))')
    expect(await lower('n -= 1', N)).toBe('n.set(n() - (1))')
    expect(await lower('n *= 2', N)).toBe('n.set(n() * (2))')
    expect(await lower('n /= 2', N)).toBe('n.set(n() / (2))')
    expect(await lower('n %= 2', N)).toBe('n.set(n() % (2))')
    expect(await lower('n **= 2', N)).toBe('n.set(n() ** (2))')
    expect(await lower('n &= 1', N)).toBe('n.set(n() & (1))')
    expect(await lower('n |= 1', N)).toBe('n.set(n() | (1))')
    expect(await lower('n ^= 1', N)).toBe('n.set(n() ^ (1))')
    expect(await lower('n <<= 1', N)).toBe('n.set(n() << (1))')
    // `>` is never merged by the SCANNER, so a token walk saw `>>=` as three tokens; the
    // checker's tree holds it as one operator.
    expect(await lower('n >>= 1', N)).toBe('n.set(n() >> (1))')
    expect(await lower('n >>>= 1', N)).toBe('n.set(n() >>> (1))')
    // And a comparison is not an assignment, whichever way the scanner hands it over.
    expect(await lower('n >= 1', N)).toBe('n() >= 1')
    expect(await lower('n >> 1', N)).toBe('n() >> 1')
})

// A LOGICAL ASSIGNMENT SHORT-CIRCUITS, and no assertion on the emitted TEXT can see it: an
// unconditional `n.set(n() || v)` stores the value the read already held, which is the right value
// and a full fan-out to every reader of it. So the lowered source is RUN, and what is asserted is
// the number of writes.
//
// THE REVERT: emit `${name}.set(${name}() ${op} (${value}))` for the three below as well; the
// truthy, the defined and the falsy case each report 1 write where 0 are due — 3 wake-ups from a
// value that never moved.
function writesMade(lowered: string, value: unknown): number {
    let writes = 0
    let held = value
    const n = Object.assign(() => held, {
        set(next: unknown): void {
            writes += 1
            held = next
        },
    })
    // THE EMITTED PROGRAM IS THE SUBJECT: an assertion on its text cannot tell a write that
    // happened from one that was skipped.
    new Function('n', lowered)(n)
    return writes
}

test('a logical assignment writes only on the branch that writes', async () => {
    expect(await lower('n ||= 1', N)).toBe('n() || n.set(1)')
    expect(await lower('n &&= 1', N)).toBe('n() && n.set(1)')
    expect(await lower('n ??= 1', N)).toBe('n() ?? n.set(1)')
    expect(writesMade(await lower('n ||= 1', N), 'held')).toBe(0)
    expect(writesMade(await lower('n ||= 1', N), '')).toBe(1)
    expect(writesMade(await lower('n &&= 1', N), '')).toBe(0)
    expect(writesMade(await lower('n &&= 1', N), 'held')).toBe(1)
    expect(writesMade(await lower('n ??= 1', N), 0)).toBe(0)
    expect(writesMade(await lower('n ??= 1', N), undefined)).toBe(1)
    // A WRITE THROUGH A PATH SHORT-CIRCUITS TOO, and the path is read to decide it.
    const U = new Set(['user'])
    expect(await lower('user.count ||= 1', U)).toBe(
        'user()["count"] || user.set(__writePath(user(), ["count"], 1))',
    )
})

// 31.4 — `n++` AND `--n` ARE THE SAME WRITE WITH THE OPERAND FIXED AT ONE, and the canonical
// counter spelling had no case at all. THE REVERT: delete the update case in `classifyRead`; the
// eight bare forms below lower to `n()++`, `n()--`, `++n()` or `--n()` — 8 emitted modules where
// the operand of an update is a call, which is a SyntaxError at parse and a ReferenceError where
// it is not. The two member paths are the path walk's half of the same sentence and survive it.
test('an increment and a decrement are writes — 31.4', async () => {
    expect(await lower('n++', N)).toBe('n.set(n() + 1)')
    expect(await lower('n--', N)).toBe('n.set(n() - 1)')
    expect(await lower('++n', N)).toBe('n.set(n() + 1)')
    expect(await lower('--n', N)).toBe('n.set(n() - 1)')
    expect(await lower('{ n++ }', N)).toBe('{ n.set(n() + 1) }')
    expect(await lower('if (x) n++', N)).toBe('if (x) n.set(n() + 1)')
    expect(await lower('for (;; n++) {}', N)).toBe('for (;; n.set(n() + 1)) {}')
    // A LINE BREAK THAT ENDS A STATEMENT IS A STATEMENT, and the short form is what makes that
    // safe: JavaScript refuses to insert a semicolon in front of a `(`, so the value-preserving
    // form on this line would have emitted a call on `f()`'s result.
    expect(await lower('f()\nn++', N)).toBe('f()\nn.set(n() + 1)')
    // 31.8 — and through a member path it is the same copy-down write `+= 1` makes.
    const U = new Set(['user'])
    expect(await lower('user.count++', U)).toBe(
        'user.set(__writePath(user(), ["count"], user()["count"] + (1)))',
    )
    expect(await lower('++user.count', U)).toBe(
        'user.set(__writePath(user(), ["count"], user()["count"] + (1)))',
    )
})

// A `++` BELONGS TO WHICHEVER OPERAND IT IS NOT SEPARATED FROM, which is JavaScript's restricted
// production read from both ends. THE REVERT: take a neighbouring `++` TOKEN for this
// name's rather than the update node the checker parented it under; the two below emit
// `a((__previous) => …)(n()) = 1` — which PARSES, and throws the write away — and
// `n.set(n() + 1)b`, which does not. 2 wrong rewrites, and only one of them is loud.
test('an update belongs to the operand on its own line', async () => {
    expect(await lower('a++\nn = 1', N)).toBe('a++\nn.set(1)')
    expect(await lower('n\n++b', N)).toBe('n()\n++b')
    expect(await lower('a++\nn++', N)).toBe('a++\nn.set(n() + 1)')
    // And a break in front of a prefix `++` is where the statement ends, so the name after it is
    // the operand it always was.
    expect(await lower('a\n++n', N)).toBe('a\nn.set(n() + 1)')
    expect(await lower('a + ++n', N)).toBe(
        'a + ((__previous) => (n.set(__previous + 1), __previous + 1))(n())',
    )
})

// A POSTFIX UPDATE IS WORTH WHAT IT READ AND A PREFIX ONE WHAT IT WROTE — JavaScript decides that,
// so the rewrite matches it wherever the value is used. THE REVERT: emit the statement form
// (`n.set(n() + 1)`) in every position; all four reads below report `undefined`, which is `set`'s
// own return — 4 values lost where the source names one.
function updateValue(lowered: string, value: unknown): unknown {
    let held = value
    const n = Object.assign(() => held, {
        set(next: unknown): void {
            held = next
        },
    })
    return new Function('n', `let out\n${lowered}\nreturn out`)(n)
}

test('a postfix update is worth the value it read', async () => {
    expect(await lower('out = n++', N)).toBe(
        'out = ((__previous) => (n.set(__previous + 1), __previous))(n())',
    )
    expect(updateValue(await lower('out = n++', N), 7)).toBe(7)
    expect(updateValue(await lower('out = n--', N), 7)).toBe(7)
    expect(updateValue(await lower('out = ++n', N), 7)).toBe(8)
    expect(updateValue(await lower('out = --n', N), 7)).toBe(6)
    // And the write is made either way.
    expect(writesMade(await lower('out = n++', N), 7)).toBe(1)
    expect(writesMade(await lower('n++', N), 7)).toBe(1)
})

// A `{` that OPENS A SLOT opens an object literal, not a block: `style={{color}}` read as a block
// emitted `{ color() }`, which does not parse. The projection stands every slot in `;(…)`, so the
// token before its brace is a `(` — while at the head of a SCRIPT the same brace is a block.
test('an object literal opening a fragment expands its shorthand', async () => {
    const page = await typed('<p data-x={{n}}></p>', N)
    expect(emitComponent(page.file, page.reads)).toContain('{n: n()}')
    expect(await lower('{n}', N)).toBe('{n()}')
    expect(await lower('x = { n }', N)).toBe('x = { n: n() }')
    expect(await lower('n = { n }', N)).toBe('n.set({ n: n() })')
    // A real block still reads as one.
    expect(await lower('if (n) { n = 1 }', N)).toBe('if (n()) { n.set(1) }')
})

// `for await (…)` puts a token between the keyword and the parenthesis. Read as a parameter
// list, the SUBJECT was bound: never lowered, so the loop iterated the `Reactive` wrapper.
//
// INSIDE A FUNCTION, because 34.3 refuses one at a script's top level — a `for await` needs an
// async context and setup is an ordinary function body, so the only place this loop can stand is
// a function of the author's own. Nothing about the LOWERING depends on that, which is what this
// asserts.
test('a for-await subject is lowered and does not shadow itself', async () => {
    expect(
        await lower(
            'async function g() { for await (const c of n) { f(c) } }',
            N,
        ),
    ).toBe('async function g() { for await (const c of n()) { f(c) } }')
    expect(await lower('for (const c of n) { f(c) }', N)).toBe(
        'for (const c of n()) { f(c) }',
    )
})

// A computed property key is a READ. Recorded as a binding, `[n]` indexed with the `Reactive`
// itself and shadowed the name for the rest of the function.
test('a computed key in a pattern is read, not bound', async () => {
    expect(
        await lower('function g() { const { [n]: v } = o; return n }', N),
    ).toBe('function g() { const { [n()]: v } = o; return n() }')
    // An array pattern's elements are still bindings.
    expect(await lower('function g() { const [n, b] = o; return n }', N)).toBe(
        'function g() { const [n, b] = o; return n }',
    )
})

// A type annotation's own comma is not the parameter list's. Read as one, the name after it was
// bound and every read of it in the body was left as the `Reactive`.
test('a generic type argument does not bind the name after its comma', async () => {
    expect(await lower('function f(a: Map<string, X>) { return n }', N)).toBe(
        'function f(a: Map<string, X>) { return n() }',
    )
})

// Any keyword after a `.` is a property name, and the scanner answers `TypeKeyword` for `type` and
// `InKeyword` for `in` wherever they stand. THE REVERT: drop the `.` test from `tokenise`'s `scan`; the
// `/ n /` below then scans as one regular expression — 1 literal where 0 are due.
test('a division after a member named like a keyword still divides', async () => {
    expect(regexes('row.type / n / 2')).toBe(0)
    expect(regexes('row.in / n / 2')).toBe(0)
    expect(await lower('const q = row.type / n / 2', N)).toBe(
        'const q = row.type / n() / 2',
    )
    expect(await lower('const q = row.in / n / 2', N)).toBe(
        'const q = row.in / n() / 2',
    )
    expect(await lower('const half = row.type / n', N)).toBe(
        'const half = row.type / n()',
    )
    expect(await lower('const half = row.count / n', N)).toBe(
        'const half = row.count / n()',
    )
    expect(await lower('const half = row.get / n', N)).toBe(
        'const half = row.get / n()',
    )
})

// An import CLAUSE holds names, and a contextual keyword there is one. Stopped on its own binding,
// the walk found no specifier and `splitImports` left the statement in the component body — an
// `import` inside a function, which does not parse.
test('an import binding named like a keyword is left whole', async () => {
    expect(await lower("import { get } from './store.ts'\nn = 1", N)).toBe(
        "import { get } from './store.ts'\nn.set(1)",
    )
})

// A DEFAULT VALUE HOLDS ITS OWN `=`, and only the inner arrow binds `n` — `g`'s body reads the
// page's. A scan of the tokens read the rest of the default as pattern text and bound `n` as a
// parameter of `g`, so `return n` handed back the `Reactive` object where its value was due.
test('an `=` inside a default value does not end the default', async () => {
    expect(
        await lower('function g(render = (n = 1) => n) { return n }', N),
    ).toBe('function g(render = (n = 1) => n) { return n() }')
    // The inner arrow binds `n` itself, so its OWN body is not lowered.
    expect(await lower('const f = (n = 1) => n', N)).toBe(
        'const f = (n = 1) => n',
    )
})

// A PRIVATE NAME ENDS A VALUE. Left out, the `/` after one re-scanned as a regular expression —
// `reScanSlashToken` hands one back even UNTERMINATED, so the rest of the line collapsed into a
// single token. THE REVERT: drop `PrivateIdentifier` from `endsOperand`;
// the division below scans as a literal — 1 where 0 are due.
test('a division after a private name still divides', async () => {
    expect(regexes('this.#t / n / 2')).toBe(0)
    expect(
        await lower('class C { #t = 4\n f() { return this.#t / n } }', N),
    ).toBe('class C { #t = 4\n f() { return this.#t / n() } }')
})

// A BLOCK'S `}` DOES NOT END A VALUE — a function body's and a class body's neither — and a
// regular expression opening the statement after one is not a division. THE REVERT: tag every `{`
// `OPERAND` in `tokenise`'s `scan`; the line below scans as a `/`, a `[`, and then one
// string literal opened by the apostrophe that runs to the end of the line — 0 literals where 1 is
// due.
test('a regex opening the statement after a block is not a division', async () => {
    expect(regexes('function clean(s) { return s }\n/[\'"]/.test(query)')).toBe(
        1,
    )
    expect(
        await lower(
            'function clean(s) { return s.trim() }\n/[\'"]/.test(query) && clean(query)',
            new Set(['query']),
        ),
    ).toBe(
        'function clean(s) { return s.trim() }\n/[\'"]/.test(query()) && clean(query())',
    )
    // A value that genuinely ends in `)` still divides.
    expect(await lower('x = f({ a: 1 }) / n', N)).toBe('x = f({ a: 1 }) / n()')
})

// A TAGGED TEMPLATE IS A CALL, so automatic semicolon insertion refuses to break in front of the
// literal exactly as it does in front of a `(`. THE REVERT: end a write's value at the line
// break rather than at the assignment's right operand; the write below cuts there and emits
// `n.set(css)` with the template left standing — 1 write storing the TAG function where the
// tagged value is due, and still a valid program, which is what makes it silent.
test('a template literal continues the value across a line break', async () => {
    expect(await lower('n = css\n`color: red`', N)).toBe(
        'n.set(css\n`color: red`)',
    )
    // biome-ignore-start lint/suspicious/noTemplateCurlyInString: the slot IS the subject.
    expect(await lower('n = css\n`color: ${x}`', N)).toBe(
        'n.set(css\n`color: ${x}`)',
    )
    // biome-ignore-end lint/suspicious/noTemplateCurlyInString: the slot IS the subject.
})

// `assert` IS THE EARLIER SPELLING OF THE IMPORT-ATTRIBUTES CLAUSE AND IS NOT A KEYWORD, so the
// grammar tells the clause from a statement of the same name by `[no LineTerminator here]`.
// STRUCTURAL HERE: the checker's tree holds the import whole, so no span is skipped by hand. What
// this caught was a skipped span running from `import` to the first balanced `}` after it, which
// left the write below as written — a plain assignment over the binding, destroying the
// `Reactive` silently. `importSpans` still answers for `splitImports`, whose test gates it.
test('a statement-leading assert is not an import attribute', async () => {
    expect(
        await lower(
            "import { deepEqual } from 'node:assert'\nassert\n{ n = 1 }",
            N,
        ),
    ).toBe("import { deepEqual } from 'node:assert'\nassert\n{ n.set(1) }")
    // The clause under its earlier spelling, written where it belongs, is still skipped whole.
    expect(
        await lower(
            "import d from './d.json' assert { type: 'json' }\nn = 1",
            N,
        ),
    ).toBe("import d from './d.json' assert { type: 'json' }\nn.set(1)")
})

// 31.5, 31.7 — `?.` REACHES A MEMBER THE SAME WAY `.` DOES, and both member guards tested the
// plain token only. THE REVERT: stop the path walk in `classifyRead` at a `?.` access; the
// first pair below then reports `user?.name()` and `s()?.ready()`.
test('an optional chain is a member reach on both guards', async () => {
    expect(await lower('user?.name', new Set(['name']))).toBe('user?.name')
    expect(await lower('s?.ready()', new Set(['s']))).toBe('s?.ready()')
    // The value's own member still reads the value first — 31.6 is what tells the two apart,
    // and `?.` does not change which side of it a name falls on.
    expect(await lower('s?.join(",")', new Set(['s']))).toBe('s()?.join(",")')
    expect(await lower('obj?.n + n', new Set(['n']))).toBe('obj?.n + n()')
})

// 19.12 — the shapes a scan of the tokens answered wrong, each of which emitted a module that does
// not parse or read the wrapper where its value was due. The checker answers every one of them;
// THE REVERT for all of them is to take reads by SPELLING — every identifier whose text is a reactive name — rather than the references `TypeSession.readsFor` asks the checker for.
test('a scope that is not a function body is not a var boundary', async () => {
    // `var` inside a catch hoists to the enclosing FUNCTION.
    expect(
        await lower('function f(){ try{}catch(e){ var n = 1 } return n }', N),
    ).toBe('function f(){ try{}catch(e){ var n = 1 } return n }')
})

test('a class body is found past its type parameters', async () => {
    // A type literal's brace in the type parameters is not the body's.
    expect(await lower('class C<T extends { a: number }> { n = 1 }', N)).toBe(
        'class C<T extends { a: number }> { n = 1 }',
    )
    expect(
        await lower('class C extends Base<{ a: number }> { n = 1 }', N),
    ).toBe('class C extends Base<{ a: number }> { n = 1 }')
})

test('an enum body names its members', async () => {
    // An enum member is a name, not a read.
    expect(await lower('enum E { n }', N)).toBe('enum E { n }')
    expect(await lower('enum E { a, n, b }', N)).toBe('enum E { a, n, b }')
    expect(await lower('export enum E { n = 1 }', N)).toBe(
        'export enum E { n = 1 }',
    )
})

test('a comma inside a type annotation is not a declarator separator', async () => {
    // `Map<string, Row>` named two TYPES. Split at that comma, `Row` was bound as a second
    // declarator and every read of the page's `Row` in the function was left as the wrapper.
    // THE REVERT: drop the angle counting from `patternEnd`; this reports `return Row` unlowered.
    expect(
        await lower(
            'function load() { const cache: Map<string, Row> = new Map(); return Row }',
            new Set(['Row']),
        ),
    ).toBe(
        'function load() { const cache: Map<string, Row> = new Map(); return Row() }',
    )
})

// 31.5, 31.6 — `REACTIVE_MEMBERS` IS A COPY OF THE RUNTIME'S OWN MEMBER LIST, and its comment
// said so while nothing checked it. A member added to the runtime without this list lowers
// `s.newMember` through the VALUE — `s().newMember` — so the call lands on the held array or
// object and throws, and a member here the runtime does not have resolves to nothing. Prose on
// one side of a seam and a hand-written list on the other is exactly what a test is for.
// THE REVERT: drop one name from `REACTIVE_MEMBERS`; this reports 14 against 15.
test('the compiler’s member list is the runtime’s', () => {
    const prototype = Object.getPrototypeOf(reactive(0)) as object
    expect(Object.getOwnPropertyNames(prototype).sort()).toEqual(
        [...REACTIVE_MEMBERS].sort(),
    )
})
