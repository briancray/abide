// WHICH TOKENS LIVE IN TYPE POSITION — the recognizer's twelve branches, and its safety invariant.
//
// `markTypeSkips` is what keeps the free-identifier passes from rewriting a TYPE operand: `x as Foo`
// must not become `x as $scope.Foo`. It is a pure `(Tok[], BraceInfo) -> Set<number>` and was ~470
// lines inside `analyzeBindings` with zero coupling to bindings, reachable only through
// `rewriteCellRefs`/`rewriteFreeIdentifiers` as a string-in/string-out rewrite. Of its twelve branches
// only `as`/`satisfies` had any assertion; the four hairiest — class body, interface, object-literal
// shorthand method, arrow return annotation, each with its own bail conditions and its own
// `matchClose`/`matchOpen` bookkeeping — had none.
//
// The SAFETY INVARIANT is the thing worth asserting rather than stating: the scan may only ever
// UNDER-mark. Leaving a type operand unmarked produces intermediate TS that is not type-valid but is
// harmless at runtime; marking a VALUE identifier stops it being rewritten to `$scope.x`, which is a
// ReferenceError at mount. Every case below therefore checks BOTH directions — what is marked, and
// that no value identifier is.

import { describe, expect, test } from 'bun:test'
import { analyzeBraces, tokenize } from './tokens.ts'
import { markTypeSkips } from './typePositions.ts'

// The TEXT of every token the recognizer placed in type position, in source order.
function marked(source: string): string[] {
    const tokens = tokenize(source)
    const skip = markTypeSkips(tokens, analyzeBraces(tokens))
    return [...skip].sort((a, b) => a - b).map((index) => tokens[index]?.text ?? '')
}

// Assert the invariant directly: none of these value identifiers may be marked.
function assertValuesUnmarked(source: string, values: string[]): void {
    const inTypePosition = new Set(marked(source))
    for (const value of values) expect(inTypePosition.has(value)).toBe(false)
}

describe('as / satisfies — the operator branch', () => {
    test('the type operand is marked, the operand being cast is not', () => {
        expect(marked('x as Foo')).toEqual(['Foo'])
        expect(marked('x satisfies Foo')).toEqual(['Foo'])
    })

    test('a ternary after a cast keeps its ARMS as values', () => {
        // The scan must stop at the `?`: the type is just `Foo`, and `a`/`b` are values that still need
        // rewriting. This is the invariant's canonical counter-example.
        expect(marked('x as Foo ? a : b')).toEqual(['Foo'])
        assertValuesUnmarked('x as Foo ? a : b', ['x', 'a', 'b'])
    })

    test('a union or intersection continues the type', () => {
        expect(marked('x as Foo | Bar')).toEqual(['Foo', 'Bar'])
        expect(marked('x as Foo & Bar')).toEqual(['Foo', 'Bar'])
    })

    test('a generic type operand marks its arguments too', () => {
        expect(marked('x as Wrapper<Inner>')).toEqual(['Wrapper', 'Inner'])
    })
})

describe('declaration annotations', () => {
    test('a `let` annotation is marked and its initializer is not', () => {
        expect(marked('let m: Map<K, V> = make()')).toEqual(['Map', 'K', 'V'])
        assertValuesUnmarked('let m: Map<K, V> = make()', ['m', 'make'])
    })

    test('a type-argument list with a top-level comma stays one type', () => {
        // The comma inside `<K, V>` is not a statement boundary; stopping there would leave `V` a value.
        expect(marked('let m: Map<K, V> = make()')).toContain('V')
    })

    test('a `function` declaration marks its param and return annotations only', () => {
        expect(marked('function fn(a: Thing): Other { return b }')).toEqual(['Thing', 'Other'])
        assertValuesUnmarked('function fn(a: Thing): Other { return b }', ['fn', 'a', 'b'])
    })
})

// ---------------------------------------------------------------------------
// The four branches that previously had no assertion at all
// ---------------------------------------------------------------------------

describe('type and interface declarations', () => {
    test('a `type` alias marks its whole declaration, both sides', () => {
        expect(marked('type Alias<T> = Wrapper<T>')).toEqual(['type', 'Alias', 'T', 'Wrapper', 'T'])
    })

    test('an `interface` body marks its members and their types', () => {
        expect(marked('interface Shape { a: Thing }')).toEqual(['Shape', 'a', 'Thing'])
    })

    test('an interface does not leak into the statement after it', () => {
        assertValuesUnmarked('interface Shape { a: Thing }\nconst value = compute()', [
            'value',
            'compute',
        ])
    })
})

describe('class bodies', () => {
    test('a field annotation is marked and its initializer is not', () => {
        expect(marked('class C { field: Thing = make() }')).toEqual(['Thing'])
        assertValuesUnmarked('class C { field: Thing = make() }', ['C', 'field', 'make'])
    })

    test('a method marks its param and return annotations only', () => {
        const source = 'class C { run(a: Thing): Other { return b } }'
        expect(marked(source)).toEqual(['Thing', 'Other'])
        assertValuesUnmarked(source, ['run', 'a', 'b'])
    })

    test('a class body does not leak into the statement after it', () => {
        assertValuesUnmarked('class C { field: Thing }\nconst value = compute()', [
            'value',
            'compute',
        ])
    })
})

describe('object-literal shorthand methods', () => {
    test('annotations inside a shorthand method are marked, the body is not', () => {
        const source = 'const o = { run(a: Thing): Other { return b } }'
        expect(marked(source)).toEqual(['Thing', 'Other'])
        assertValuesUnmarked(source, ['o', 'run', 'a', 'b'])
    })

    test('an ordinary object property is entirely values', () => {
        // `{ a: b }` is a property, not an annotation — marking `b` would strand it unrewritten. This
        // is the branch's whole difficulty: the same `:` means two things by brace kind.
        expect(marked('const o = { a: b }')).toEqual([])
    })
})

describe('arrow functions', () => {
    test('param and RETURN annotations are marked, the body is not', () => {
        const source = 'const f = (a: Thing): Other => value'
        expect(marked(source)).toEqual(['Thing', 'Other'])
        assertValuesUnmarked(source, ['f', 'a', 'value'])
    })

    test('an arrow with no annotations marks nothing', () => {
        expect(marked('const f = (a) => a + b')).toEqual([])
    })
})

describe('generic call arguments', () => {
    test('the type arguments are marked, the value arguments are not', () => {
        expect(marked('call<Generic>(argument)')).toEqual(['Generic'])
        assertValuesUnmarked('call<Generic>(argument)', ['call', 'argument'])
    })

    test('a LESS-THAN comparison is not a type argument list', () => {
        // `<` is ambiguous. Claiming this one would mark `b` and `c` as types and strand them.
        expect(marked('const t = a < b, c > d')).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// The invariant, stated as a sweep
// ---------------------------------------------------------------------------

describe('the safety invariant: only ever UNDER-mark', () => {
    test.each([
        ['a plain expression', 'a + b * c', ['a', 'b', 'c']],
        ['a call', 'compute(first, second)', ['compute', 'first', 'second']],
        ['a member chain', 'thing.field.other', ['thing']],
        ['a template literal', 'render(`a ${value} b`)', ['render', 'value']],
        ['an object literal', 'const o = { key: value }', ['value']],
        ['an array literal', 'const list = [first, second]', ['first', 'second']],
        ['a ternary', 'flag ? yes : no', ['flag', 'yes', 'no']],
        ['an arrow body', 'const f = () => compute(value)', ['compute', 'value']],
    ] as const)('%s marks no value identifier', (_label, source, values) => {
        assertValuesUnmarked(source, [...values])
    })

    test('a source with NO type syntax marks nothing at all', () => {
        expect(marked('const total = first + second')).toEqual([])
    })

    test('an empty source is handled', () => {
        expect(marked('')).toEqual([])
    })
})
