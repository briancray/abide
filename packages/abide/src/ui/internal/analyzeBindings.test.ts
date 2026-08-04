// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the rewriter's INPUT and OUTPUT are source
// text, so a `${…}` inside a quoted string here is the fixture, not a mis-quoted template literal.

import { describe, expect, test } from 'bun:test'
import { SyntaxKind } from 'typescript/unstable/ast'
import { createScanner } from 'typescript/unstable/ast/scanner'
import {
    analyzeBindings,
    type CellBindings,
    rewriteCellRefs,
    rewriteFreeIdentifiers,
} from './analyzeBindings.ts'
import { parse } from './parse.ts'

const CELLS = (...names: string[]): CellBindings => ({
    cells: new Set(names),
    memos: new Set(),
})

// `rewriteFreeIdentifiers` takes a plain set of DECLARED script bindings.
const DECLARED = (...names: string[]): Set<string> => new Set(names)

// An auto-called memo scope (ADR 0024 §5).
const MEMOS = (...names: string[]): CellBindings => ({
    cells: new Set(),
    memos: new Set(names),
})

// ---------------------------------------------------------------------------
// rewriteCellRefs — reads
// ---------------------------------------------------------------------------

describe('rewriteCellRefs reads', () => {
    test('simple read', () => {
        expect(rewriteCellRefs('n', CELLS('n'))).toBe('n()')
    })

    test('read inside an expression', () => {
        expect(rewriteCellRefs('n + 1', CELLS('n'))).toBe('n() + 1')
    })

    test('multiple cells', () => {
        expect(rewriteCellRefs('a + b', CELLS('a', 'b'))).toBe('a() + b()')
    })

    test('non-cell identifier left alone', () => {
        expect(rewriteCellRefs('n + other', CELLS('n'))).toBe('n() + other')
    })

    test('empty cell set is a no-op', () => {
        expect(rewriteCellRefs('n = 5', CELLS())).toBe('n = 5')
    })

    test('read in a ternary', () => {
        expect(rewriteCellRefs('cond ? n : m', CELLS('n', 'm'))).toBe('cond ? n() : m()')
    })
})

// ---------------------------------------------------------------------------
// rewriteCellRefs — assignment
// ---------------------------------------------------------------------------

describe('rewriteCellRefs assignment', () => {
    test('simple assignment', () => {
        expect(rewriteCellRefs('n = 5', CELLS('n'))).toBe('n.set( 5)')
    })

    test('assignment with expression RHS', () => {
        expect(rewriteCellRefs('n = a + 1', CELLS('n'))).toBe('n.set( a + 1)')
    })

    test('assignment RHS cells are also rewritten', () => {
        expect(rewriteCellRefs('n = a + 1', CELLS('n', 'a'))).toBe('n.set( a() + 1)')
    })

    test('chained assignment nests writes', () => {
        expect(rewriteCellRefs('n = m = 5', CELLS('n', 'm'))).toBe('n.set( m.set( 5))')
    })

    test('assignment inside a call closes before the paren', () => {
        expect(rewriteCellRefs('foo(n = 1)', CELLS('n'))).toBe('foo(n.set( 1))')
    })

    test('assignment RHS stops at a comma', () => {
        expect(rewriteCellRefs('f(n = 1, 2)', CELLS('n'))).toBe('f(n.set( 1), 2)')
    })

    test('assignment RHS spanning a ternary', () => {
        expect(rewriteCellRefs('n = a ? b : c', CELLS('n'))).toBe('n.set( a ? b : c)')
    })

    // `rhsExtent`'s continuation set used to be a private copy that had drifted from the check
    // lane's: it knew `+` and `.` but not `? :`, `as`, `instanceof`, `in`, or template middles. Each
    // of these truncated at the line break and emitted `n.set( <head>)` followed by an orphaned tail
    // — which is not a syntax error, so nothing downstream complained: the cell was silently set to
    // the head and the tail evaluated against the discarded result. Both lanes now read one set.
    describe('a multi-line RHS is not severed at the line break', () => {
        const spans: Array<[string, string]> = [
            ['a ternary', 'n = cond\n  ? a\n  : b'],
            ['an `as` cast', 'n = x\n  as number'],
            ['an `instanceof`', 'n = a\n  instanceof B'],
            ['an `in`', 'n = a\n  in b'],
            ['a binary operator', 'n = a +\n  b'],
            ['a member chain', 'n = a\n  .b()'],
        ]
        for (const [what, source] of spans) {
            test(what, () => {
                expect(rewriteCellRefs(source, CELLS('n'))).toBe(
                    `n.set( ${source.slice('n = '.length)})`,
                )
            })
        }

        test('but a genuine statement boundary still ends the RHS', () => {
            expect(rewriteCellRefs('n = 1\nm = 2', CELLS('n', 'm'))).toBe('n.set( 1)\nm.set( 2)')
        })
    })

    // The same rule, asked by the DECLARATION scan — which is what decides the answers below and did
    // not apply it. A depth-0 line break ended the statement unconditionally, so a declarator list
    // broken across lines lost every binding after the break: `b` was neither declared nor a cell,
    // `{b}` rendered empty, and `b = 5` was never rewritten to `.set()`. Nothing threw, and the check
    // lane — whose own copy of the rule was correct — stayed green over it.
    describe('a multi-line declarator list keeps every binding', () => {
        const bindings = (script: string): { declared: string[]; cells: string[] } => {
            const analysis = analyzeBindings(parse(`<script>${script}</script><p>x</p>`))
            return { declared: [...analysis.declared], cells: [...analysis.cellBindings.cells] }
        }

        test('plain declarators', () => {
            expect(bindings('let a = 1,\n    b = 2').declared).toEqual(['a', 'b'])
        })

        test('cells', () => {
            expect(bindings('let a = state(1),\n    b = state(2)').cells).toEqual(['a', 'b'])
        })

        test('the break may fall before the comma', () => {
            expect(bindings('let a = 1\n    , b = 2').declared).toEqual(['a', 'b'])
        })

        test('and a genuine boundary still ends the declaration', () => {
            expect(bindings('let a = 1\nlet b = 2').declared).toEqual(['a', 'b'])
            expect(bindings('let a = 1\nb.c()').declared).toEqual(['a'])
        })
    })

    // The template kinds are role-asymmetric (see CONTINUATION_OPERATORS). `TemplateTail` used to be
    // in `afterPrev`, so a line ENDING in one never ended the RHS — the closing paren landed after the
    // following statements instead of after the literal, which is a syntax error only if what got
    // swallowed happens to be one. Assert both directions: a tail ends an RHS, a head does not.
    describe('a template literal on the RHS', () => {
        test('ends the RHS at its closing backtick', () => {
            expect(rewriteCellRefs('n = `a ${b}`\nconst after = 1', CELLS('n'))).toBe(
                'n.set( `a ${b}`)\nconst after = 1',
            )
        })

        test('ends it after the LAST substitution', () => {
            expect(rewriteCellRefs('n = `a ${b} c ${d}`\nconst after = 1', CELLS('n'))).toBe(
                'n.set( `a ${b} c ${d}`)\nconst after = 1',
            )
        })

        test('ends it with no substitution at all', () => {
            expect(rewriteCellRefs('n = `plain`\nconst after = 1', CELLS('n'))).toBe(
                'n.set( `plain`)\nconst after = 1',
            )
        })

        test('is not severed when a substitution spans lines', () => {
            expect(rewriteCellRefs('n = `a ${\n  b\n}`\nconst after = 1', CELLS('n'))).toBe(
                'n.set( `a ${\n  b\n}`)\nconst after = 1',
            )
        })

        test('keeps a member access on the literal', () => {
            expect(rewriteCellRefs('n = `x`.length\nconst after = 1', CELLS('n'))).toBe(
                'n.set( `x`.length)\nconst after = 1',
            )
        })

        test('works as a compound-assignment RHS', () => {
            expect(rewriteCellRefs('n += `a ${b}`\nconst after = 1', CELLS('n'))).toBe(
                'n.set(n() + ( `a ${b}`))\nconst after = 1',
            )
        })
    })
})

// ---------------------------------------------------------------------------
// rewriteCellRefs — compound assignment (all operators)
// ---------------------------------------------------------------------------

describe('rewriteCellRefs compound assignment', () => {
    const cases: [string, string][] = [
        ['n += x', 'n.set(n() + ( x))'],
        ['n -= x', 'n.set(n() - ( x))'],
        ['n *= x', 'n.set(n() * ( x))'],
        ['n /= x', 'n.set(n() / ( x))'],
        ['n %= x', 'n.set(n() % ( x))'],
        ['n **= x', 'n.set(n() ** ( x))'],
        ['n &= x', 'n.set(n() & ( x))'],
        ['n |= x', 'n.set(n() | ( x))'],
        ['n ^= x', 'n.set(n() ^ ( x))'],
        ['n <<= x', 'n.set(n() << ( x))'],
        ['n >>= x', 'n.set(n() >> ( x))'],
        ['n >>>= x', 'n.set(n() >>> ( x))'],
        ['n &&= x', 'n.set(n() && ( x))'],
        ['n ||= x', 'n.set(n() || ( x))'],
        ['n ??= x', 'n.set(n() ?? ( x))'],
    ]
    for (const [input, expected] of cases) {
        test(input, () => {
            expect(rewriteCellRefs(input, CELLS('n'))).toBe(expected)
        })
    }

    test('compound RHS is parenthesized to preserve precedence', () => {
        expect(rewriteCellRefs('n += a + b', CELLS('n'))).toBe('n.set(n() + ( a + b))')
    })
})

// ---------------------------------------------------------------------------
// rewriteCellRefs — increment / decrement
// ---------------------------------------------------------------------------

describe('rewriteCellRefs increment/decrement', () => {
    test('postfix ++', () => {
        expect(rewriteCellRefs('n++', CELLS('n'))).toBe('n.set(n() + 1)')
    })
    test('postfix --', () => {
        expect(rewriteCellRefs('n--', CELLS('n'))).toBe('n.set(n() - 1)')
    })
    test('prefix ++', () => {
        expect(rewriteCellRefs('++n', CELLS('n'))).toBe('n.set(n() + 1)')
    })
    test('prefix --', () => {
        expect(rewriteCellRefs('--n', CELLS('n'))).toBe('n.set(n() - 1)')
    })
    test('prefix increment mid-expression', () => {
        expect(rewriteCellRefs('a + ++n', CELLS('n'))).toBe('a + n.set(n() + 1)')
    })
    test('postfix increment mid-expression', () => {
        expect(rewriteCellRefs('n++ + a', CELLS('n'))).toBe('n.set(n() + 1) + a')
    })
    test('non-cell postfix left alone', () => {
        expect(rewriteCellRefs('x++', CELLS('n'))).toBe('x++')
    })
})

// ---------------------------------------------------------------------------
// rewriteCellRefs — operator disambiguation (`=` vs `==`/`===`/`=>`/`<=`/`>=`/`!=`)
// ---------------------------------------------------------------------------

describe('rewriteCellRefs operator disambiguation', () => {
    test('== is not an assignment', () => {
        expect(rewriteCellRefs('n == 5', CELLS('n'))).toBe('n() == 5')
    })
    test('=== is not an assignment', () => {
        expect(rewriteCellRefs('n === 5', CELLS('n'))).toBe('n() === 5')
    })
    test('!= / !== are not assignments', () => {
        expect(rewriteCellRefs('n != 5', CELLS('n'))).toBe('n() != 5')
        expect(rewriteCellRefs('n !== 5', CELLS('n'))).toBe('n() !== 5')
    })
    test('<= and >= are not assignments', () => {
        expect(rewriteCellRefs('n <= 5', CELLS('n'))).toBe('n() <= 5')
        expect(rewriteCellRefs('n >= 5', CELLS('n'))).toBe('n() >= 5')
    })
    test('=> single-param arrow is not an assignment (param shadows)', () => {
        expect(rewriteCellRefs('n => n + 1', CELLS('n'))).toBe('n => n + 1')
    })
})

// ---------------------------------------------------------------------------
// rewriteCellRefs — member access, object keys, shorthand
// ---------------------------------------------------------------------------

describe('rewriteCellRefs member and object handling', () => {
    test('member access is not rewritten', () => {
        expect(rewriteCellRefs('obj.n', CELLS('n'))).toBe('obj.n')
    })
    test('optional member access is not rewritten', () => {
        expect(rewriteCellRefs('obj?.n', CELLS('n'))).toBe('obj?.n')
    })
    test('cell before a member access still reads', () => {
        expect(rewriteCellRefs('n.foo', CELLS('n'))).toBe('n().foo')
    })
    test('object key is not rewritten', () => {
        expect(rewriteCellRefs('({ n: 1 })', CELLS('n'))).toBe('({ n: 1 })')
    })
    test('object shorthand becomes a read', () => {
        expect(rewriteCellRefs('({ n })', CELLS('n'))).toBe('({ n: n() })')
    })
    test('mixed keys and shorthand', () => {
        expect(rewriteCellRefs('({ a, n: 1, b })', CELLS('a', 'b'))).toBe(
            '({ a: a(), n: 1, b: b() })',
        )
    })
    test('object value position is a read', () => {
        expect(rewriteCellRefs('({ k: n })', CELLS('n'))).toBe('({ k: n() })')
    })
    test('object method name is not rewritten', () => {
        expect(rewriteCellRefs('({ n() { return 1 } })', CELLS('n'))).toBe('({ n() { return 1 } })')
    })
})

// ---------------------------------------------------------------------------
// rewriteCellRefs — string / template / comment literals
// ---------------------------------------------------------------------------

describe('rewriteCellRefs literals are protected', () => {
    test('cell inside a double-quoted string is not rewritten', () => {
        expect(rewriteCellRefs('"n is n"', CELLS('n'))).toBe('"n is n"')
    })
    test('cell inside a single-quoted string is not rewritten', () => {
        expect(rewriteCellRefs("'n'", CELLS('n'))).toBe("'n'")
    })
    test('cell inside a no-substitution template is not rewritten', () => {
        expect(rewriteCellRefs('`n and n`', CELLS('n'))).toBe('`n and n`')
    })
    test('template substitution IS rewritten, surrounding text is not', () => {
        expect(rewriteCellRefs('`x${n}y`', CELLS('n'))).toBe('`x${n()}y`')
    })
    test('multiple template substitutions', () => {
        expect(rewriteCellRefs('`${n}-${m}`', CELLS('n', 'm'))).toBe('`${n()}-${m()}`')
    })
    test('template tail text matching a cell name is not rewritten', () => {
        // After `${a}` the literal `n` is template tail text, not code.
        expect(rewriteCellRefs('`${a}n`', CELLS('a', 'n'))).toBe('`${a()}n`')
    })
    test('cell in a line comment is not rewritten', () => {
        expect(rewriteCellRefs('a // n\n+ a', CELLS('a', 'n'))).toBe('a() // n\n+ a()')
    })
})

// ---------------------------------------------------------------------------
// rewriteCellRefs — declaration sites and shadowing
// ---------------------------------------------------------------------------

describe('rewriteCellRefs declarations and shadowing', () => {
    test('top-level declaration keeps the lexical name; later refs rewrite', () => {
        expect(rewriteCellRefs('let n = state(0); n = 5; n + 1', CELLS('n'))).toBe(
            'let n = state(0); n.set( 5); n() + 1',
        )
    })

    test('function parameter shadows the cell in the body', () => {
        expect(rewriteCellRefs('function f(n){ return n } n', CELLS('n'))).toBe(
            'function f(n){ return n } n()',
        )
    })

    test('multi-param arrow parameter shadows in the body', () => {
        expect(rewriteCellRefs('(a, n) => n + count', CELLS('n', 'count'))).toBe(
            '(a, n) => n + count()',
        )
    })

    test('nested let shadows the cell in that block', () => {
        expect(rewriteCellRefs('function g(){ let n = 5; return n } n', CELLS('n'))).toBe(
            'function g(){ let n = 5; return n } n()',
        )
    })

    test('cell referenced inside a non-shadowing function still rewrites', () => {
        expect(rewriteCellRefs('function h(){ return n + 1 }', CELLS('n'))).toBe(
            'function h(){ return n() + 1 }',
        )
    })

    test('references before a nested shadow still rewrite', () => {
        expect(rewriteCellRefs('n; function f(n){ return n }', CELLS('n'))).toBe(
            'n(); function f(n){ return n }',
        )
    })
})

// ---------------------------------------------------------------------------
// rewriteFreeIdentifiers — type-position operands (TODO #11 / #18 follow-up)
// ---------------------------------------------------------------------------

describe('rewriteFreeIdentifiers type-position operands', () => {
    const rw = (code: string) => rewriteFreeIdentifiers(code, DECLARED(), '$s')

    test('value operand rewritten, `as` type operand left alone', () => {
        expect(rw('(x as Foo).bar')).toBe('($s.x as Foo).bar')
    })

    test('qualified type name is not rewritten', () => {
        expect(rw('x as Foo.Bar')).toBe('$s.x as Foo.Bar')
    })

    test('array type suffix is not rewritten', () => {
        expect(rw('value as Widget[]')).toBe('$s.value as Widget[]')
    })

    test('primitive-keyword union type is not rewritten', () => {
        expect(rw('n as string | number')).toBe('$s.n as string | number')
    })

    test('generic type arguments are not rewritten', () => {
        expect(rw('x as Map<string, User>')).toBe('$s.x as Map<string, User>')
    })

    test('intersection type is not rewritten', () => {
        expect(rw('x as A & B & C')).toBe('$s.x as A & B & C')
    })

    test('leading `readonly` type operator is not rewritten', () => {
        expect(rw('arr as readonly Item[]')).toBe('$s.arr as readonly Item[]')
    })

    test('object / function types are not rewritten', () => {
        expect(rw('obj as { a: Foo }')).toBe('$s.obj as { a: Foo }')
        expect(rw('f as (p: P) => R')).toBe('$s.f as (p: P) => R')
    })

    test('`satisfies` operand is not rewritten', () => {
        expect(rw('x satisfies Config')).toBe('$s.x satisfies Config')
    })

    test('double assertion', () => {
        expect(rw('x as unknown as Bar')).toBe('$s.x as unknown as Bar')
    })

    // The safety invariant: values AFTER the type must stay rewritten (never over-skip into value pos).
    test('ternary arms after `x as Foo ?` stay rewritten', () => {
        expect(rw('x as Foo ? a : b')).toBe('$s.x as Foo ? $s.a : $s.b')
    })

    test('operand after the assertion stays rewritten', () => {
        expect(rw('(x as Foo) + y')).toBe('($s.x as Foo) + $s.y')
        expect(rw('x as Foo, y')).toBe('$s.x as Foo, $s.y')
    })

    test('a plain `<` comparison (no `as`) is untouched', () => {
        expect(rw('a < b')).toBe('$s.a < $s.b')
    })

    test('assertion inside a ternary branch', () => {
        expect(rw('x ? y as T : z')).toBe('$s.x ? $s.y as T : $s.z')
    })
})

// ---------------------------------------------------------------------------
// rewriteCellRefs — a cell name in a TYPE position is not a read
// ---------------------------------------------------------------------------

// Props and cells share a component's vocabulary, so `const rest = memo(…)` beside
// `props<{ rest?: string }>()` is ordinary authoring — and it used to emit `props<{ rest()?: string }>()`,
// a build failure. Non-optional members escaped by accident (`isObjectKey`'s `name:` test), so the same
// script broke or not depending on a `?`.
describe('rewriteCellRefs type positions', () => {
    const rw = (code: string) => rewriteCellRefs(code, CELLS('count', 'n'))
    const rwMemo = (code: string) => rewriteCellRefs(code, MEMOS('rest'))

    test('type arguments of a call — the props<{…}>() case', () => {
        expect(rwMemo('const { a } = props<{ rest?: string }>()')).toBe(
            'const { a } = props<{ rest?: string }>()',
        )
        expect(rw('const { a } = props<{ count: number }>()')).toBe(
            'const { a } = props<{ count: number }>()',
        )
    })

    test('type arguments of a `new` expression', () => {
        expect(rwMemo('const m = new Map<string, rest>()')).toBe(
            'const m = new Map<string, rest>()',
        )
    })

    test('declaration annotations', () => {
        expect(rwMemo('let x: rest = null')).toBe('let x: rest = null')
        expect(rwMemo('let x: { rest?: string } = y')).toBe('let x: { rest?: string } = y')
    })

    test('type alias body', () => {
        expect(rw('type T = Array<count>')).toBe('type T = Array<count>')
        expect(rw('type T = { count?: string } | n')).toBe('type T = { count?: string } | n')
    })

    test('interface body', () => {
        expect(rw('interface Foo { count?: number; n: string }')).toBe(
            'interface Foo { count?: number; n: string }',
        )
    })

    test('function parameter annotations and return type', () => {
        expect(rwMemo('function f(p: { rest: number }): rest { return 1 }')).toBe(
            'function f(p: { rest: number }): rest { return 1 }',
        )
    })

    test('arrow parameter annotations, with and without a return type', () => {
        expect(rw('const g = (p: { count: number }) => 1')).toBe(
            'const g = (p: { count: number }) => 1',
        )
        expect(rwMemo('const g = (p: rest): rest => 1')).toBe('const g = (p: rest): rest => 1')
    })

    // The safety invariant, in the direction that MATTERS: over-marking would silently stop rewriting a
    // real cell read, which no value assertion catches (the emitted code still reads the right name — it
    // just reads the CELL instead of its value, and never subscribes).
    test('values around type positions stay rewritten', () => {
        expect(rw('type X = string; const v = count')).toBe('type X = string; const v = count()')
        expect(rw('interface I { a: string }\nconst v = count')).toBe(
            'interface I { a: string }\nconst v = count()',
        )
        expect(rw('const v = a < count && b > (n)')).toBe('const v = a < count() && b > (n())')
        expect(rw('const v = cond ? count : n')).toBe('const v = cond ? count() : n()')
        expect(rw('const v = { a: count, b: n }')).toBe('const v = { a: count(), b: n() }')
    })

    test('a destructuring RENAME is not an annotation', () => {
        expect(rwMemo('function f({ rest: local }) { return local }')).toBe(
            'function f({ rest: local }) { return local }',
        )
    })

    test('class member annotations — methods, properties, `#private` fields', () => {
        expect(rwMemo('class C { m(a: rest): rest { return 1 } }')).toBe(
            'class C { m(a: rest): rest { return 1 } }',
        )
        expect(rwMemo('class C { x: rest = 1 }')).toBe('class C { x: rest = 1 }')
        expect(rwMemo('class C { #p: rest }')).toBe('class C { #p: rest }')
    })

    test('object-literal shorthand method annotations', () => {
        expect(rwMemo('const o = { m(a: rest) { return 1 } }')).toBe(
            'const o = { m(a: rest) { return 1 } }',
        )
    })

    // The counterpart guard: an object literal's `key: value` is a VALUE, so the member walker that
    // reads a CLASS `x: T` as an annotation must not read this one the same way.
    test('object-literal property VALUES are still rewritten', () => {
        expect(rw('const v = { a: count, b: n }')).toBe('const v = { a: count(), b: n() }')
        expect(rw('send({ tag: 1, value: count })')).toBe('send({ tag: 1, value: count() })')
        expect(rw('const v = { outer: { inner: count } }')).toBe(
            'const v = { outer: { inner: count() } }',
        )
        expect(rw('const v = { m(x) { return count }, a: n }')).toBe(
            'const v = { m(x) { return count() }, a: n() }',
        )
    })
})

// ---------------------------------------------------------------------------
// analyzeBindings — cell recognition + real dual-script root
// ---------------------------------------------------------------------------

describe('analyzeBindings cell recognition', () => {
    test('state / memo / memo(...).state() recognized (ADR 0024)', () => {
        const root = parse(
            "<script>import { state } from 'abide/shared/state'; import { memo } from 'abide/shared/memo'; let n = state(0); const d = memo(()=>n*2); let e = memo(()=>n).state()</script>{n}",
        )
        const analysis = analyzeBindings(root)
        // `cellBindings.cells` is WRITABILITY: the owned cell and the memo's writable projection, not the memo.
        expect([...analysis.cellBindings.cells].sort()).toEqual(['e', 'n'])
        expect([...analysis.cellBindings.memos].sort()).toEqual(['d'])
        const instance = analysis.instance
        if (instance === null) throw new Error('expected an instance script')
        const kinds = Object.fromEntries(instance.bindings.map((b) => [b.name, b.kind]))
        expect(kinds.n).toBe('state')
        expect(kinds.d).toBe('memo')
        expect(kinds.e).toBe('state')
    })

    test('aliased state import (import { state as s })', () => {
        const root = parse(
            "<script>import { state as s } from 'abide/shared/state'; let n = s(0); let d = s.shared('k', 0)</script>{n}",
        )
        const analysis = analyzeBindings(root)
        expect([...analysis.cellBindings.cells].sort()).toEqual(['d', 'n'])
        const instance = analysis.instance
        if (instance === null) throw new Error('expected an instance script')
        expect(instance.setupCode).toBe(" let n = s(0); let d = s.shared('k', 0)")
    })

    test('props() destructuring marks bindings as prop', () => {
        const root = parse(
            "<script>import { props } from 'abide/ui/props'; const {who, age} = props()</script>{who}",
        )
        const analysis = analyzeBindings(root)
        const instance = analysis.instance
        if (instance === null) throw new Error('expected an instance script')
        const kinds = Object.fromEntries(instance.bindings.map((b) => [b.name, b.kind]))
        expect(kinds.who).toBe('prop')
        expect(kinds.age).toBe('prop')
        expect(analysis.cellBindings.cells.size).toBe(0)
    })

    // A declarator list is split by the SHARED scanner (`scanText`), so text inside a string literal
    // can no longer be mistaken for a binding. The build lane used to split naively while the check lane
    // skipped strings, so this script bound a phantom `y` that the template then emitted as a bare
    // lexical reference — a ReferenceError at mount, with `abide check` green.
    test('a comma inside a string literal does not fabricate a binding', () => {
        const analysis = analyzeBindings(parse('<script>let a = "x,y", b = 1</script><p>{a}</p>'))
        expect([...analysis.declared].sort()).toEqual(['a', 'b'])
    })

    test('a comma inside a nested template substitution does not fabricate a binding', () => {
        const analysis = analyzeBindings(
            parse('<script>let x = `a${`b,c`}d`, y = 1</script><p>{x}</p>'),
        )
        expect([...analysis.declared].sort()).toEqual(['x', 'y'])
    })

    test('dual-script root: module + instance', () => {
        const root = parse(
            "<script module>import { state } from 'abide/shared/state'; let g = state(1)</script>" +
                "<script>import { props } from 'abide/ui/props'; import greet from '../rpc/greet'; let n = state(0); function inc(){ n++ }</script>" +
                '<p>{n}</p>',
        )
        const analysis = analyzeBindings(root)

        expect([...analysis.cellBindings.cells].sort()).toEqual(['g', 'n'])
        expect(analysis.declared.has('state')).toBe(true)
        expect(analysis.declared.has('greet')).toBe(true)
        expect(analysis.declared.has('inc')).toBe(true)

        // module setup keeps its lexical cell; imports are stripped.
        const moduleScript = analysis.module
        if (moduleScript === null) throw new Error('expected a module script')
        expect(moduleScript.setupCode).toContain('let g = state(1)')
        expect(moduleScript.setupCode).not.toContain('import')
        const firstModuleImport = moduleScript.imports[0]
        if (firstModuleImport === undefined) throw new Error('expected a module import')
        expect(firstModuleImport.specifier).toBe('abide/shared/state')

        // instance setup rewrites the cell reference inside the function body; imports stripped.
        const instanceScript = analysis.instance
        if (instanceScript === null) throw new Error('expected an instance script')
        expect(instanceScript.setupCode).toContain('function inc(){ n.set(n() + 1) }')
        expect(instanceScript.setupCode).not.toContain('import')
        const instanceImports = instanceScript.imports.map((i) => i.specifier).sort()
        expect(instanceImports).toEqual(['../rpc/greet', 'abide/ui/props'])
    })

    test('null scripts when absent', () => {
        const root = parse('<p>hello</p>')
        const analysis = analyzeBindings(root)
        expect(analysis.module).toBeNull()
        expect(analysis.instance).toBeNull()
        expect(analysis.cellBindings.cells.size).toBe(0)
    })

    test('module cells do not rewrite instance-only names and vice versa', () => {
        const root = parse(
            "<script module>import { state } from 'abide/shared/state'; let g = state(1)</script>" +
                "<script>import { state } from 'abide/shared/state'; let n = state(0)</script>{n}",
        )
        const analysis = analyzeBindings(root)
        // instance can reference module cell g:
        expect([...analysis.cellBindings.cells].sort()).toEqual(['g', 'n'])
    })
})

// ---------------------------------------------------------------------------
// Fuzz / property test
// ---------------------------------------------------------------------------

// Tokenize helper mirroring analyzeBindings's scanner usage (build-time only).
function scanKinds(source: string): { kind: SyntaxKind; text: string }[] {
    const scanner = createScanner(true, 0, source)
    const out: { kind: SyntaxKind; text: string }[] = []
    const frames: string[] = []
    for (;;) {
        let kind = scanner.scan()
        if (kind === SyntaxKind.EndOfFile) break
        if (kind === SyntaxKind.CloseBraceToken && frames[frames.length - 1] === 't') {
            kind = scanner.reScanTemplateToken(false)
            if (kind === SyntaxKind.TemplateTail) frames.pop()
        } else if (kind === SyntaxKind.TemplateHead) frames.push('t')
        else if (kind === SyntaxKind.OpenBraceToken) frames.push('b')
        else if (kind === SyntaxKind.CloseBraceToken) frames.pop()
        out.push({ kind, text: scanner.getTokenText() })
    }
    return out
}

describe('rewriteCellRefs fuzz/property', () => {
    // Small seeded PRNG for reproducibility.
    function makeRng(seed: number): () => number {
        let s = seed >>> 0
        return () => {
            s = (s * 1664525 + 1013904223) >>> 0
            return s / 0x100000000
        }
    }

    const CELL_NAMES = ['a', 'b', 'c']
    const cellSet = CELLS(...CELL_NAMES)

    // Each fragment is valid JS on its own and, per the rewrite rules, must contain no bare cell read.
    function makeFragment(rng: () => number): string {
        const cell = CELL_NAMES[Math.floor(rng() * CELL_NAMES.length)]
        if (cell === undefined) throw new Error('cell-name index out of range')
        const forms = [
            cell,
            `${cell} = 2`,
            `${cell} += 3`,
            `${cell} -= 1`,
            `${cell} *= 2`,
            `${cell} ??= 4`,
            `${cell}++`,
            `${cell}--`,
            `++${cell}`,
            `--${cell}`,
            `${cell} + 1`,
        ]
        const form = forms[Math.floor(rng() * forms.length)]
        if (form === undefined) throw new Error('form index out of range')
        return form
    }

    test('output re-parses and no cell survives as a bare read', () => {
        const rng = makeRng(0xc0ffee)
        for (let iteration = 0; iteration < 500; iteration++) {
            const count = 1 + Math.floor(rng() * 4)
            const fragments: string[] = []
            for (let f = 0; f < count; f++) fragments.push(makeFragment(rng))
            const input = fragments.join('; ')
            const output = rewriteCellRefs(input, cellSet)

            // 1. Output must compile (no error/Unknown tokens; valid as a function body).
            expect(() => new Function('a', 'b', 'c', output)).not.toThrow()
            const tokens = scanKinds(output)
            for (const tok of tokens) expect(tok.kind).not.toBe(SyntaxKind.Unknown)

            // 2. No bare cell read survives: every cell-named identifier is immediately followed by
            //    the call parens of a read (`n(`) or the `.set(` of a write (these fragments contain
            //    no declarations, members, or object keys).
            for (const [i, tok] of tokens.entries()) {
                if (tok.kind !== SyntaxKind.Identifier) continue
                if (!cellSet.cells.has(tok.text)) continue
                const next = tokens[i + 1]
                const after = tokens[i + 2]
                const isRead = next !== undefined && next.kind === SyntaxKind.OpenParenToken
                const isWrite =
                    next !== undefined &&
                    next.kind === SyntaxKind.DotToken &&
                    after !== undefined &&
                    after.text === 'set'
                expect(isRead || isWrite).toBe(true)
            }
        }
    })
})

// ---------------------------------------------------------------------------
// rewriteCellRefs — memo auto-call + dependency position (ADR 0024 §5)
// ---------------------------------------------------------------------------

describe('rewriteCellRefs memo auto-call', () => {
    test('a bare memo reference auto-calls', () => {
        expect(rewriteCellRefs('d + 1', MEMOS('d'))).toBe('d() + 1')
    })

    // A memo reads exactly like a cell, INCLUDING before a member access — `{d.length}` is the VALUE's
    // length, not the memo object's arity. (Getting this wrong silently rendered `1` for every
    // `{transcript.length}` in the docs app.) The memo's own surface is not reachable through the binding.
    test('a member access reads the VALUE, as it does for a cell', () => {
        expect(rewriteCellRefs('d.length', MEMOS('d'))).toBe('d().length')
        expect(rewriteCellRefs('d?.length', MEMOS('d'))).toBe('d()?.length')
    })

    test('a memo is read-only: a write form is left verbatim (a const assignment throws)', () => {
        expect(rewriteCellRefs('d = 5', MEMOS('d'))).toBe('d = 5')
        expect(rewriteCellRefs('d += 5', MEMOS('d'))).toBe('d += 5')
    })

    test('object shorthand becomes a read', () => {
        expect(rewriteCellRefs('({ d })', MEMOS('d'))).toBe('({ d: d() })')
    })
})

// A destructured PARAMETER binds its names — they shadow a same-named cell, and the pattern is a binding
// form, not an object literal. Before this was handled, a collision both lost the shadow and expanded the
// pattern, emitting invalid JS (`({ a: a() }) =>`, `([a()]) =>`). The multi-dependency form makes the
// collision the normal spelling (`memo({ a, b }, ({ a, b }) => …)`), so it is pinned here.
describe('rewriteCellRefs destructured parameter bindings', () => {
    test('an object pattern parameter shadows the cell and is not expanded', () => {
        expect(rewriteCellRefs('list.map(({ a }) => a + 1)', CELLS('a'))).toBe(
            'list.map(({ a }) => a + 1)',
        )
    })

    test('an array pattern parameter shadows the cell and is not expanded', () => {
        expect(rewriteCellRefs('list.map(([a]) => a + 1)', CELLS('a'))).toBe(
            'list.map(([a]) => a + 1)',
        )
    })

    test('a destructured function parameter binds too', () => {
        expect(rewriteCellRefs('function f({ a }) { return a }', CELLS('a'))).toBe(
            'function f({ a }) { return a }',
        )
    })

    test('a RENAMED property binds the new name; the key is not a reference', () => {
        expect(rewriteCellRefs('list.map(({ x: a }) => a + 1)', CELLS('a'))).toBe(
            'list.map(({ x: a }) => a + 1)',
        )
    })

    test('a DEFAULT value is still a reference and is rewritten', () => {
        expect(rewriteCellRefs('list.map(({ x = a }) => x + 1)', CELLS('a'))).toBe(
            'list.map(({ x = a() }) => x + 1)',
        )
    })

    test('a nested pattern binds at every level', () => {
        expect(rewriteCellRefs('list.map(({ o: { a } }) => a + 1)', CELLS('a'))).toBe(
            'list.map(({ o: { a } }) => a + 1)',
        )
    })

    test('the shadow ends with the function — the outer cell still reads after it', () => {
        expect(rewriteCellRefs('list.map(({ a }) => a + 1); use(a)', CELLS('a'))).toBe(
            'list.map(({ a }) => a + 1); use(a())',
        )
    })
})

describe('rewriteCellRefs source position (ADR 0025 — thunk only)', () => {
    // There is no dependency-position exception any more. A `memo`/`watch` source is a THUNK, so every
    // identifier is an ordinary read and the rewriter has one rule instead of two.
    test('inside the source thunk a cell reads like anywhere else', () => {
        expect(rewriteCellRefs('watch(() => count, handler)', CELLS('count'))).toBe(
            'watch(() => count(), handler)',
        )
    })

    test('several inputs are just what the thunk returns — values, not nodes', () => {
        expect(
            rewriteCellRefs('memo(() => ({ a, b }), ({ a, b }) => a + b)', CELLS('a', 'b')),
        ).toBe('memo(() => ({ a: a(), b: b() }), ({ a, b }) => a + b)')
    })

    test('the transform body still reads its own cells', () => {
        expect(rewriteCellRefs('memo(() => a, (v) => v + b)', MEMOS('a', 'b'))).toBe(
            'memo(() => a(), (v) => v + b())',
        )
    })

    test('a BARE cell in the source slot now reads as a value, like every other argument', () => {
        // The old sugar suppressed this read. It is a type error at the call (`number` is not `() => T`),
        // which is exactly the diagnostic a reader wants — the thunk is not optional.
        expect(rewriteCellRefs('watch(count, handler)', CELLS('count'))).toBe(
            'watch(count(), handler)',
        )
    })

    test('an explicit generic argument list is untouched', () => {
        expect(rewriteCellRefs('memo<number>(() => a, t)', MEMOS('a'))).toBe(
            'memo<number>(() => a(), t)',
        )
    })

    test('a cell passed to any other callee still reads', () => {
        expect(rewriteCellRefs('log(count)', CELLS('count'))).toBe('log(count())')
    })
})

// ---------------------------------------------------------------------------
// analyzeBindings — memo binding classification (ADR 0024 §5)
// ---------------------------------------------------------------------------

describe('analyzeBindings memo bindings', () => {
    const scopeOf = (script: string) =>
        analyzeBindings(parse(`<script>${script}</script><span>{d}</span>`))

    test('an argless fn literal is auto-called', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo(() => 1)",
        )
        expect([...analysis.cellBindings.memos]).toEqual(['d'])
        expect([...analysis.cellBindings.cells]).toEqual([])
    })

    // A return type annotation is ordinary TypeScript, and the classifier used to miss it entirely:
    // the binding fell through to "opaque", a bare `{d}` read the memo OBJECT, and `abide check` stayed
    // green because the check lane types the binding through `__abideUnwrap` rather than this
    // classifier. Nothing but the emit lane could see the difference, so the guard belongs here.
    test('an annotated argless thunk is auto-called', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo((): number => 1)",
        )
        expect([...analysis.cellBindings.memos]).toEqual(['d'])
    })

    // Both spellings of a function-type return: the parenthesised type and the bare one. They differ in
    // WHICH depth-zero arrow comes first (the body's vs the type's) and `)` precedes both, so any rule
    // that tried to tell them apart would have to reparameterise the group the way TypeScript does.
    // These two pin that the classifier does not try — the first depth-zero arrow answers either way.
    test('a parenthesised FUNCTION-TYPE annotation is auto-called', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo((): ((x: number) => string) => String)",
        )
        expect([...analysis.cellBindings.memos]).toEqual(['d'])
    })

    test('an UNPARENTHESISED function-type annotation is auto-called too', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo((): (x: number) => string => String)",
        )
        expect([...analysis.cellBindings.memos]).toEqual(['d'])
    })

    // A comma-bearing type argument must survive the param split (`skipTypeArguments`) before the
    // annotation skip ever runs — otherwise the source is truncated at `Map<string` and classifies as
    // opaque for a reason that has nothing to do with the annotation.
    test('a generic annotation with a top-level comma is auto-called', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo((): Map<string, number> => m)",
        )
        expect([...analysis.cellBindings.memos]).toEqual(['d'])
    })

    test('an annotated argless FUNCTION expression is auto-called', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo(function (): number { return 1 })",
        )
        expect([...analysis.cellBindings.memos]).toEqual(['d'])
    })

    // The annotation skip must not widen what classifies: an annotated ASYNC body is still a promise
    // read that would blank the SSR text, and an annotated ARGED handler is still args-keyed.
    test('an annotated ASYNC body is still NOT auto-called', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo(async (): Promise<number> => 1)",
        )
        expect([...analysis.cellBindings.memos]).toEqual([])
    })

    test('an annotated ARGED handler is still NOT auto-called', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo((args: Args): string => args.id)",
        )
        expect([...analysis.cellBindings.memos]).toEqual([])
    })

    test('memo(…).state() is a writable CELL, not an auto-called memo', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; let d = memo(() => 1).state()",
        )
        expect([...analysis.cellBindings.cells]).toEqual(['d'])
        expect([...analysis.cellBindings.memos]).toEqual([])
    })

    // The multi-dependency form is a sync memo like every other declared-source form — without this it
    // stays unclassified and a bare `{d}` renders the memo FUNCTION instead of its value.
    test('a source thunk WITH a transform is auto-called', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo(() => ({ a, b }), ({ a, b }) => a + b)",
        )
        expect([...analysis.cellBindings.memos]).toEqual(['d'])
        expect([...analysis.cellBindings.cells]).toEqual([])
    })

    test('a source thunk with a .state() projection is still a writable CELL', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; let d = memo(() => a, (v) => v).state()",
        )
        expect([...analysis.cellBindings.cells]).toEqual(['d'])
        expect([...analysis.cellBindings.memos]).toEqual([])
    })

    test('an opaque fn reference is NOT auto-called (guessing would emit undefined args)', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo(loadThing)",
        )
        expect([...analysis.cellBindings.memos]).toEqual([])
    })

    test('an ASYNC argless body is NOT auto-called (a promise read would blank the SSR text)', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo(async () => 1)",
        )
        expect([...analysis.cellBindings.memos]).toEqual([])
    })

    test('an ARGED handler is NOT auto-called', () => {
        const analysis = scopeOf(
            "import { memo } from 'abide/shared/memo'; const d = memo((args) => args.id)",
        )
        expect([...analysis.cellBindings.memos]).toEqual([])
    })

    // A BARE node source no longer classifies — the source must be a thunk (ADR 0025), and guessing
    // otherwise would auto-call a binding whose initializer the compiler cannot see through.
    test('a bare node in the source slot is NOT auto-called', () => {
        const analysis = scopeOf(
            "import { state } from 'abide/shared/state'; import { memo } from 'abide/shared/memo'; let a = state(1); const d = memo(a, (v) => v + 1)",
        )
        expect([...analysis.cellBindings.memos]).toEqual([])
    })

    test('a memo declared in the MODULE script is visible to the instance script', () => {
        const analysis = analyzeBindings(
            parse(
                "<script module>import { memo } from 'abide/shared/memo'; const base = memo(() => 1)</script>" +
                    "<script>import { memo } from 'abide/shared/memo'; const d = memo(() => base, (v) => v + 1)</script>" +
                    '<span>{d}</span>',
            ),
        )
        expect([...analysis.cellBindings.memos].sort()).toEqual(['base', 'd'])
    })
})
