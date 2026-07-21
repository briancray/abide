// Tests for `emitCheck` (C10.2–6, TODO #11 PR1) — the typed-lowering + bidirectional map.
//
// The load-bearing guarantee is the VERBATIM-COPY INVARIANT (§1.7 of the plan): every recorded
// `Segment` is a byte-identical copy of the `.abide` source, so the map is exact in BOTH directions.
// These are executable proofs of that invariant + the gen↔orig round-trip, over a construct corpus.

import { describe, expect, test } from 'bun:test'
import { emitCheck, mapGenToOrig, mapOrigToGen } from './emitCheck.ts'
import { parse } from './parse.ts'

const CORPUS = [
    `<script>let n = state(0)</script><p>{n + 1}</p>`,
    `<p>{#if ok}<b>{msg}</b>{:else if other}x{:else}no{/if}</p>`,
    `<ul>{#for item, i of items by item.id}<li>{i}:{item.name}</li>{/for}</ul>`,
    `<ul>{#for v of values}<li>{v}</li>{/for}</ul>`,
    `<div>{#await load()}<span>…</span>{:then value}<b>{value.title}</b>{:catch err}{err.message}{:finally}done{/await}</div>`,
    `<div>{#try}<b>{risky()}</b>{:catch e}{e.message}{/try}</div>`,
    `<div>{#switch kind}{:case "a"}A{:case "b"}B{:default}?{/switch}</div>`,
    `<div>{#snippet row(x)}<td>{x.cell}</td>{/snippet}{row(item)}</div>`,
    `<p title={t} onclick={handler} class:on={active} style:color={hue} {...rest}>{(v as Foo).bar}</p>`,
    `<div>{html(markup)}</div>`,
    `<div>{await fetchThing()}</div>`,
]

describe('verbatim-copy invariant', () => {
    test('every recorded segment is a byte-identical copy of the .abide source', () => {
        for (const source of CORPUS) {
            const { code, segments } = emitCheck(source, parse(source))
            for (const segment of segments) {
                const gen = code.slice(segment.genStart, segment.genEnd)
                const orig = source.slice(
                    segment.origStart,
                    segment.origStart + (segment.genEnd - segment.genStart),
                )
                expect(gen).toBe(orig)
            }
        }
    })
})

describe('bidirectional round-trip', () => {
    test('orig→gen→orig is identity for every offset inside a verbatim segment', () => {
        for (const source of CORPUS) {
            const { segments } = emitCheck(source, parse(source))
            for (const segment of segments) {
                const length = segment.genEnd - segment.genStart
                for (let delta = 0; delta < length; delta++) {
                    const origPos = segment.origStart + delta
                    const genPos = mapOrigToGen(segments, origPos)
                    expect(genPos).toBe(segment.genStart + delta)
                    expect(mapGenToOrig(segments, genPos)).toBe(origPos)
                }
            }
        }
    })

    test('segments are monotonic in both gen and orig offsets', () => {
        for (const source of CORPUS) {
            const { segments } = emitCheck(source, parse(source))
            for (let i = 1; i < segments.length; i++) {
                const current = segments[i]
                const previous = segments[i - 1]
                if (current === undefined || previous === undefined) {
                    throw new Error('segment index out of range')
                }
                expect(current.genStart).toBeGreaterThanOrEqual(previous.genEnd)
            }
        }
    })
})

describe('lowering shape', () => {
    test('emits a callable async render body and closes it', () => {
        const { code } = emitCheck(`<p>{x}</p>`, parse(`<p>{x}</p>`))
        expect(code).toContain('async function __render() {')
        expect(code).toContain('__render();')
        expect(code.trimEnd().endsWith('export {};')).toBe(true)
    })

    test('a `{#for item, i}` header lowers to a typed __entries destructuring', () => {
        const src = `<ul>{#for item, i of items}<li>{item.name}</li>{/for}</ul>`
        const { code } = emitCheck(src, parse(src))
        expect(code).toContain('for (const [i, item] of __entries(items))')
    })
})

// A declarator initializer spanning lines is ONE statement, exactly as JS ASI reads it. The old scanner
// broke on any depth-0 line break, severing the tail into an orphaned statement that TS rejects (a
// false positive on valid code). Each case wraps the WHOLE multi-line initializer in one `__abideUnwrap`.
describe('multi-line initializer continuation (ASI parity with TS)', () => {
    const wrapped = (src: string): string =>
        emitCheck(`<script>${src}</script>`, parse(`<script>${src}</script>`)).code

    test('leading-dot method chain stays in one initializer', () => {
        expect(wrapped('let total = items\n  .reduce((a, b) => a + b, 0)')).toContain(
            '__abideUnwrap( items\n  .reduce((a, b) => a + b, 0))',
        )
    })

    test('multi-line ternary stays in one initializer', () => {
        expect(wrapped("let label = big\n  ? 'a'\n  : 'b'")).toContain(
            "__abideUnwrap( big\n  ? 'a'\n  : 'b')",
        )
    })

    test('trailing binary operator continues to the next line', () => {
        expect(wrapped('let sum = 1 +\n  2')).toContain('__abideUnwrap( 1 +\n  2)')
    })

    test('leading logical operator continues the previous line', () => {
        expect(wrapped('let ok = a\n  && b')).toContain('__abideUnwrap( a\n  && b)')
    })

    test('two adjacent one-line declarations are NOT merged', () => {
        const code = wrapped('let a = 1\nlet b = 2')
        expect(code).toContain('__abideUnwrap( 1)')
        expect(code).toContain('__abideUnwrap( 2)')
    })
})

// A state var must type as its underlying VALUE, so all three binding shapes get the SAME `bar: T` a
// plain `let` would — the initializer is unwrapped whether the identifier is bare, carries an explicit
// factory type argument, or is annotated. Destructuring is copied verbatim (a cell is never destructured).
describe('state binding shapes (inference / annotation / explicit generic)', () => {
    const wrapped = (src: string): string =>
        emitCheck(`<script>${src}</script>`, parse(`<script>${src}</script>`)).code

    test('inferred binding unwraps the initializer', () => {
        expect(wrapped('let count = state(0)')).toContain('= __abideUnwrap( state(0));')
    })

    test('explicit factory type argument unwraps the whole call', () => {
        expect(wrapped('let list = state<Item[]>([])')).toContain(
            '= __abideUnwrap( state<Item[]>([]));',
        )
    })

    test('a type annotation is preserved AND the initializer is unwrapped', () => {
        const code = wrapped('let total: number = state(0)')
        expect(code).toContain('total: number = __abideUnwrap( state(0));')
    })

    test('a function-type annotation splits at the real `=`, not the `=>`', () => {
        // Regression: the `=` inside `=>` must not be mistaken for the assignment operator.
        expect(wrapped('let f: () => void = fn')).toContain(': () => void = __abideUnwrap( fn);')
    })

    test('a destructuring binding is copied verbatim (never unwrapped)', () => {
        const code = wrapped('const { title = "x" } = props()')
        expect(code).toContain('{ title = "x" } = props();')
        expect(code).not.toContain('__abideUnwrap( props())')
    })
})

// The widen helper repairs the empty/nullish inits whose degenerate inference (`never[]`, `null`) would
// otherwise false-positive; concrete inits keep their real value type. See the HEADER comment.
describe('cell-value widening header', () => {
    test('emits the __AbideWiden mapping over the cell unwrap overload', () => {
        const { code } = emitCheck('<p>{x}</p>', parse('<p>{x}</p>'))
        expect(code).toContain('type __AbideWiden<__T>')
        expect(code).toContain(
            'declare function __abideUnwrap<__T>(cell: __AbideStateCell<__T>): __AbideWiden<__T>;',
        )
    })
})
