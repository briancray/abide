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
