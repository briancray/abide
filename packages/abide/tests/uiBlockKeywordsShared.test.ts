import { describe, expect, test } from 'bun:test'
import { BLOCK_OPENERS } from '../src/lib/ui/compile/BLOCK_KEYWORDS.ts'
import { parseTemplate } from '../src/lib/ui/compile/parseTemplate.ts'
import { templateSemanticTokens } from '../src/lib/ui/compile/templateSemanticTokens.ts'

/*
Guards the shared BLOCK_KEYWORDS vocabulary against drift between the parser
(`parseTemplate`) and the LSP highlighter (`templateSemanticTokens`, walk-driven) — the
split that once left `{#snippet}` heads uncolored. Every opener the shared list names must
(1) be a real block the parser accepts and (2) get a `keyword` token from the highlighter.
A new control block added to the parser but not the list breaks its own dispatch first;
one listed but not colored fails here.
*/

/* A minimal well-formed body for each opener, so parseTemplate reaches its dispatch
   rather than throwing on a missing expression. */
const SAMPLE: Record<string, string> = {
    if: '{#if x}a{/if}',
    for: '{#for items as x}a{/for}',
    await: '{#await p}a{/await}',
    switch: '{#switch x}{:case 1}a{/switch}',
    try: '{#try}a{/try}',
    snippet: '{#snippet row(x)}a{/snippet}',
}

describe('BLOCK_KEYWORDS shared vocabulary', () => {
    for (const opener of BLOCK_OPENERS) {
        test(`the parser accepts {#${opener}}`, () => {
            const source = SAMPLE[opener]
            expect(source, `no sample body for opener "${opener}"`).toBeDefined()
            // Parsing a well-formed block of this opener must not throw "unknown control block".
            expect(() => parseTemplate(source as string)).not.toThrow(/unknown control block/)
        })

        test(`the highlighter colors {#${opener}} as a keyword`, () => {
            const tokens = templateSemanticTokens(`{#${opener} x}`)
            const keyword = tokens.find((t) => t.type === 'keyword')
            expect(keyword, `no keyword token emitted for {#${opener}}`).toBeDefined()
        })
    }

    test('regression: {#snippet} is colored (the head the hand-copy once dropped)', () => {
        const tokens = templateSemanticTokens('{#snippet row(x)}')
        expect(tokens.some((t) => t.type === 'keyword')).toBe(true)
    })
})
