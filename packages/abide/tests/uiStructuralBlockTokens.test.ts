import { describe, expect, test } from 'bun:test'
import { structuralBlockTokens } from '../src/lib/ui/compile/structuralBlockTokens.ts'

const keywordsOf = (source: string) =>
    structuralBlockTokens(source)
        .filter((t) => t.type === 'keyword')
        .map((t) => source.slice(t.start, t.start + t.length))

describe('structuralBlockTokens', () => {
    test('colors if / else if / else / close keywords', () => {
        const source = `{#if a}x{:else if b}y{:else}z{/if}`
        expect(keywordsOf(source)).toEqual(['if', 'else if', 'else', 'if'])
    })

    test('colors for and for await', () => {
        expect(keywordsOf(`{#for a of xs}{/for}`)).toEqual(['for', 'of', 'for'])
        expect(keywordsOf(`{#for await a of xs}{/for}`)).toEqual(['for await', 'of', 'for'])
    })

    test('colors await / then / catch / finally and switch / case / default and try', () => {
        expect(keywordsOf(`{#await p}{:then v}{:catch e}{:finally}{/await}`)).toEqual([
            'await',
            'then',
            'catch',
            'finally',
            'await',
        ])
        expect(keywordsOf(`{#switch s}{:case 1}{:default}{/switch}`)).toEqual([
            'switch',
            'case',
            'default',
            'switch',
        ])
        expect(keywordsOf(`{#try}{:catch e}{/try}`)).toEqual(['try', 'catch', 'try'])
    })

    test('emits an operator token at the opening brace+sigil', () => {
        const tokens = structuralBlockTokens(`{#if a}`)
        const opener = tokens.find((t) => t.type === 'operator')
        expect(opener).toBeDefined()
        expect(opener!.start).toBe(0)
        expect(opener!.length).toBe(2)
    })

    test('ignores interpolations and @-tags', () => {
        expect(structuralBlockTokens(`<p>{name}</p>{@const x = 1}{@html y}`)).toEqual([])
    })

    test('does not treat a non-keyword sigil run as a block', () => {
        /* `{:foo}` is not a known continuation keyword. */
        expect(structuralBlockTokens(`{:foo}`)).toEqual([])
    })

    test('colors the of/by connectors inside a for head', () => {
        expect(keywordsOf(`{#for frame of frames by frame.n}{/for}`)).toEqual([
            'for',
            'of',
            'by',
            'for',
        ])
        expect(keywordsOf(`{#for await a of xs}{/for}`)).toEqual(['for await', 'of', 'for'])
    })

    test('does not color of/by nested in a destructure, call, or as an identifier', () => {
        /* the `of` inside `({of: 1})` is depth>0; `profile`/`nearby` are not boundaries */
        expect(keywordsOf(`{#for x of pick({of: 1}).nearby by x.id}{/for}`)).toEqual([
            'for',
            'of',
            'by',
            'for',
        ])
    })
})
