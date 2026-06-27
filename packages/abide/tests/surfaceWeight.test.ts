import { expect, test } from 'bun:test'
import {
    bandFor,
    extractBlockKeywords,
    extractCompositionKinds,
    extractReactiveCallees,
    extractTemplateAttrKinds,
    GRAMMAR_BUCKETS,
    SLUG_GRAMMAR,
} from '../scripts/surfaceWeight.ts'

test('extractBlockKeywords pulls every string in the BLOCK_KEYWORDS array', () => {
    const source = `const BLOCK_KEYWORDS = [\n  'for await',\n  'else if',\n  'if',\n  'for',\n]\n`
    expect(extractBlockKeywords(source)).toEqual(['for await', 'else if', 'if', 'for'])
})

test('extractTemplateAttrKinds returns directive kinds, excluding static literals', () => {
    const source = `export type TemplateAttr =
    | { kind: 'static'; name: string }
    | { kind: 'expression'; code: string }
    | { kind: 'event'; code: string }
    | { kind: 'bind'; code: string }
    | { kind: 'class'; code: string }
    | { kind: 'style'; code: string }
    | { kind: 'attach'; code: string }
    | { kind: 'spread'; code: string }`
    expect(extractTemplateAttrKinds(source)).toEqual([
        'expression',
        'event',
        'bind',
        'class',
        'style',
        'attach',
        'spread',
    ])
})

test('extractReactiveCallees reads the REACTIVE_CALLEES set members', () => {
    const source = `export const REACTIVE_CALLEES: ReadonlySet<string> = new Set([\n  'state',\n  'linked',\n  'computed',\n  'props',\n])`
    expect(extractReactiveCallees(source)).toEqual(['state', 'linked', 'computed', 'props'])
})

test('extractCompositionKinds returns distinct snippet/component node kinds', () => {
    const source = `| { kind: 'component'; name: string }
    | { kind: 'snippet'; name: string; children: TemplateNode[] }`
    expect(extractCompositionKinds(source).sort()).toEqual(['component', 'snippet'])
})

test('bandFor: weight bands and the line backstop', () => {
    expect(bandFor(1)).toBe('light')
    expect(bandFor(2)).toBe('light')
    expect(bandFor(3)).toBe('medium')
    expect(bandFor(6)).toBe('medium')
    expect(bandFor(7)).toBe('heavy')
    expect(bandFor(25)).toBe('heavy')
    expect(bandFor(3, 300)).toBe('heavy') // line backstop forces heavy
    expect(bandFor(3, 200)).toBe('medium')
})

test('SLUG_GRAMMAR attributes buckets only to the two grammar-owning slugs', () => {
    expect(Object.keys(SLUG_GRAMMAR).sort()).toEqual(['reactive-state', 'templating'])
    expect(SLUG_GRAMMAR.templating).toEqual(['control-flow', 'bindings', 'snippets'])
    expect(SLUG_GRAMMAR['reactive-state']).toEqual(['primitives'])
    // every attributed bucket name resolves to a real extractor source
    for (const buckets of Object.values(SLUG_GRAMMAR)) {
        for (const bucket of buckets) {
            expect(GRAMMAR_BUCKETS[bucket]).toBeDefined()
        }
    }
})
