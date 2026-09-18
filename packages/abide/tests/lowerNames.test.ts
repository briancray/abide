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
