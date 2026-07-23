import { describe, expect, test } from 'bun:test'
import { ABIDE_SEMANTIC_TOKENS_LEGEND } from './ABIDE_SEMANTIC_TOKENS_LEGEND.ts'
import { encodeSemanticTokens } from './encodeSemanticTokens.ts'
import { templateSemanticTokens } from './templateSemanticTokens.ts'

// The [start, length) slice of `source` a token covers, paired with its type — the readable form.
function spans(source: string): Array<{ text: string; type: string }> {
    return templateSemanticTokens(source).map((token) => ({
        text: source.slice(token.start, token.start + token.length),
        type: token.type,
    }))
}

describe('templateSemanticTokens', () => {
    test('colors element tags and attributes', () => {
        const result = spans('<div class="x" id=y>hi</div>')
        expect(result).toEqual([
            { text: '<', type: 'operator' },
            { text: 'div', type: 'tag' },
            { text: 'class', type: 'attribute' },
            { text: '=', type: 'operator' },
            { text: '"x"', type: 'string' },
            { text: 'id', type: 'attribute' },
            { text: '=', type: 'operator' },
            { text: 'y', type: 'string' },
            { text: '>', type: 'operator' },
            { text: '</', type: 'operator' },
            { text: 'div', type: 'tag' },
            { text: '>', type: 'operator' },
        ])
    })

    test('a TitleCase tag is a component (type), lowercase is a tag', () => {
        const result = spans('<Foo/><bar/>')
        expect(result.filter((s) => s.text === 'Foo')[0]?.type).toBe('type')
        expect(result.filter((s) => s.text === 'bar')[0]?.type).toBe('tag')
    })

    test('colors block framing keywords and braces', () => {
        const result = spans('{#if a}<x/>{:else if b}<y/>{:else}<z/>{/if}')
        const keywords = result.filter((s) => s.type === 'keyword').map((s) => s.text)
        expect(keywords).toEqual(['if', 'else', 'if', 'else', 'if'])
        expect(result.filter((s) => s.text === '{#')[0]?.type).toBe('operator')
        expect(result.filter((s) => s.text === '{/')[0]?.type).toBe('operator')
    })

    test('interpolation interiors are syntactically colored; identifiers stay default', () => {
        const result = spans('<p>{count + 1}</p>')
        expect(result.some((s) => s.text === '{' && s.type === 'operator')).toBe(true)
        expect(result.some((s) => s.text === '}' && s.type === 'operator')).toBe(true)
        expect(result.some((s) => s.text === '+' && s.type === 'operator')).toBe(true)
        expect(result.some((s) => s.text === '1' && s.type === 'number')).toBe(true)
        // An identifier gets no token — no type info to tell variable/function/property apart.
        expect(result.some((s) => s.text === 'count')).toBe(false)
    })

    test('await/html interpolations color the keyword, string literals, and operators', () => {
        const result = spans('<p>{await hello({ who: "reader" })}</p>')
        expect(result.some((s) => s.text === 'await' && s.type === 'keyword')).toBe(true)
        expect(result.some((s) => s.text === '"reader"' && s.type === 'string')).toBe(true)
        expect(result.some((s) => s.text === ':' && s.type === 'operator')).toBe(true)
        // The callee/prop identifiers are left at the default color.
        expect(result.some((s) => s.text === 'hello' || s.text === 'who')).toBe(false)
    })

    test('block header expressions are colored (not just interpolations)', () => {
        const ifResult = spans('<div>{#if a.length > 0}x{/if}</div>')
        expect(ifResult.some((s) => s.text === '.' && s.type === 'operator')).toBe(true)
        expect(ifResult.some((s) => s.text === '0' && s.type === 'number')).toBe(true)
        // `of` in a `{#for}` header is a keyword; the abide-specific `by` is not.
        const forResult = spans('<ul>{#for x of xs by x.id}<li/>{/for}</ul>')
        expect(forResult.some((s) => s.text === 'of' && s.type === 'keyword')).toBe(true)
        expect(forResult.some((s) => s.text === 'by' && s.type === 'keyword')).toBe(false)
    })

    test('attribute value expressions are colored', () => {
        const result = spans('<b on:click={go(42)} value={ok ? 1 : 2}/>')
        expect(result.some((s) => s.text === '42' && s.type === 'number')).toBe(true)
        expect(result.some((s) => s.text === '?' && s.type === 'operator')).toBe(true)
        expect(result.some((s) => s.text === '1' && s.type === 'number')).toBe(true)
    })

    test('comments are one comment token', () => {
        expect(spans('<!-- hi -->')).toEqual([{ text: '<!-- hi -->', type: 'comment' }])
    })

    test('<script> bodies are colored (keywords, strings, comments) — not left to injection', () => {
        const result = spans(
            '<script>\nimport { x } from "y"\n// a note\nconst n = 5\n</script><p>hi</p>',
        )
        expect(result.some((s) => s.text === 'import' && s.type === 'keyword')).toBe(true)
        expect(result.some((s) => s.text === 'from' && s.type === 'keyword')).toBe(true)
        expect(result.some((s) => s.text === '"y"' && s.type === 'string')).toBe(true)
        expect(result.some((s) => s.text === '// a note' && s.type === 'comment')).toBe(true)
        expect(result.some((s) => s.text === '5' && s.type === 'number')).toBe(true)
        // Identifiers in the script stay at the default color.
        expect(result.some((s) => s.text === 'n' || s.text === 'x')).toBe(false)
    })

    test('an invalid tail yields partial tokens for the valid head', () => {
        // Unclosed `{#if` — parse throws, but the head is already colored.
        const result = spans('<div>ok</div>{#if')
        expect(result.some((s) => s.text === 'div' && s.type === 'tag')).toBe(true)
    })
})

describe('encodeSemanticTokens', () => {
    test('emits five ints per token, delta-encoded and non-negative', () => {
        const source = '<div>\n  {x}\n</div>'
        const data = encodeSemanticTokens(source, templateSemanticTokens(source))
        expect(data.length % 5).toBe(0)
        for (let i = 0; i < data.length; i += 5) {
            expect(data[i]).toBeGreaterThanOrEqual(0) // deltaLine
            expect(data[i + 1]).toBeGreaterThanOrEqual(0) // deltaChar
            expect(data[i + 2]).toBeGreaterThan(0) // length
            expect(data[i + 3]).toBeLessThan(ABIDE_SEMANTIC_TOKENS_LEGEND.tokenTypes.length) // type
        }
    })

    test('splits a multi-line token into one segment per line', () => {
        const source = '<!--\nx\n-->'
        const data = encodeSemanticTokens(source, templateSemanticTokens(source))
        // 3 covered lines (`<!--`, `x`, `-->`) → 3 segments → 15 ints.
        expect(data.length).toBe(15)
    })
})
