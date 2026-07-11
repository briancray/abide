import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Glob } from 'bun'
import { BLOCK_CONNECTORS, BLOCK_OPENERS } from '../src/lib/ui/compile/BLOCK_KEYWORDS.ts'
import { templateSemanticTokens } from '../src/lib/ui/compile/templateSemanticTokens.ts'

/*
`templateSemanticTokens` is the ONE walk-driven producer that replaced the two
hand-rolled lexers (`markupTokens` + `structuralBlockTokens`). It drives the LSP's
markup (tag/type/attribute/string/comment + `<`/`>`/`=`/`/` operators) AND structural
(`{#…}`/`{:…}`/`{/…}` operator + keyword) coloring from the same parse that builds the
tree, so nothing can drift from what the parser accepts. These cases port both deleted
lexer suites; a corpus loop guards every emitted token against source drift.
*/

/* The substring each emitted token covers, paired with its legend type. */
const spans = (source: string) =>
    templateSemanticTokens(source).map((token) => ({
        text: source.slice(token.start, token.start + token.length),
        type: token.type,
    }))

const typed = (source: string, type: string) =>
    spans(source)
        .filter((span) => span.type === type)
        .map((span) => span.text)

/* The keyword lexemes (structural block words + `of`/`by` connectors), in walk order. */
const keywordsOf = (source: string) => typed(source, 'keyword')

describe('templateSemanticTokens — markup', () => {
    test('colors a lowercase element tag name', () => {
        expect(typed(`<p>hi</p>`, 'tag')).toEqual(['p', 'p'])
    })

    test('colors an uppercase component tag name as a type', () => {
        expect(typed(`<CodeBlock />`, 'type')).toEqual(['CodeBlock'])
    })

    test('colors attribute names and quoted values', () => {
        const source = `<a href="/x" class='y'>z</a>`
        expect(typed(source, 'attribute')).toEqual(['href', 'class'])
        expect(typed(source, 'string')).toEqual(['"/x"', "'y'"])
    })

    test('colors brackets and = as operators', () => {
        expect(typed(`<p id="x">y</p>`, 'operator')).toEqual(['<', '=', '>', '</', '>'])
    })

    test('colors an HTML comment, including multiline (one span)', () => {
        expect(typed(`<!-- hi -->`, 'comment')).toEqual(['<!-- hi -->'])
        expect(typed(`<!-- a\nb -->`, 'comment')).toEqual(['<!-- a\nb -->'])
    })

    test('skips an `{expr}` region — a `<` inside an expression is not a tag', () => {
        expect(typed(`<p>{a < b}</p>`, 'tag')).toEqual(['p', 'p'])
        expect(typed(`<p>{a < b}</p>`, 'operator')).toEqual(['<', '>', '</', '>'])
    })

    test('skips a brace attribute value without consuming the closing tag', () => {
        const source = `<a class={x}>z</a>`
        expect(typed(source, 'tag')).toEqual(['a', 'a'])
        expect(typed(source, 'attribute')).toEqual(['class'])
    })

    /* A multiline template-literal `{`...`}` attribute holding literal `{ }` and a
       comment must not desync the scan — the element after it still gets a tag token. */
    test('resumes after a multiline template-literal brace attribute', () => {
        const source = [
            `<CodeBlock code={\`await getEcho({ message: 'hello' })`,
            `await createEcho({ message: 'hello' })`,
            `// headEcho resolves to undefined\`} />`,
            `<section><h2>next</h2></section>`,
        ].join('\n')
        expect(typed(source, 'tag')).toEqual(['section', 'h2', 'h2', 'section'])
        expect(typed(source, 'type')).toEqual(['CodeBlock'])
    })

    test('tokenizes the <script>/<style> open+close TAGS but not their raw bodies', () => {
        const source = `<script>\nconst t = a < b ? 1 : 2\n</script>\n<style>\np { color: red }\n</style>\n<p>x</p>`
        /* The `<` in the script body is JS, not a tag; only the real tag names count. */
        expect(typed(source, 'tag')).toEqual(['script', 'script', 'style', 'style', 'p', 'p'])
    })

    test('skips `{expr}` interpolations inside a quoted attribute value', () => {
        const source = `<p class="a {b} c">x</p>`
        expect(typed(source, 'string')).toEqual([`"a `, ` c"`])
    })

    test('colors an unquoted attribute value as a string', () => {
        expect(typed(`<input type=text>`, 'string')).toEqual(['text'])
    })

    test('emits a two-char /> operator for a self-closing tag', () => {
        expect(typed(`<br />`, 'operator')).toEqual(['<', '/>'])
    })
})

describe('templateSemanticTokens — structural blocks', () => {
    test('colors if / else if / else / close keywords', () => {
        expect(keywordsOf(`{#if a}x{:else if b}y{:else}z{/if}`)).toEqual([
            'if',
            'else if',
            'else',
            'if',
        ])
    })

    test('colors for and for await', () => {
        expect(keywordsOf(`{#for a of xs}{/for}`)).toEqual(['for', 'of', 'for'])
        expect(keywordsOf(`{#for await a of xs}{/for}`)).toEqual(['for await', 'of', 'for'])
    })

    test('colors await/then/catch/finally, switch/case/default, and try', () => {
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

    test('colors {#snippet} heads', () => {
        expect(keywordsOf(`{#snippet row(x)}a{/snippet}`)).toEqual(['snippet', 'snippet'])
    })

    test('emits an operator token at the opening brace+sigil', () => {
        const tokens = templateSemanticTokens(`{#if a}a{/if}`)
        const opener = tokens.find((t) => t.type === 'operator' && t.start === 0)
        expect(opener).toBeDefined()
        expect(opener!.length).toBe(2)
    })

    test('does not treat a non-keyword sigil run as a block', () => {
        /* A stray `{:foo}` at top level is consumed as a stray branch — no token. */
        expect(templateSemanticTokens(`{:foo}`)).toEqual([])
    })

    test('leaves bare {expr} interpolations and @-tags uncolored', () => {
        const source = `<p>{name}</p>{@const x = 1}{@html y}`
        /* No structural coloring: no keyword tokens and no `{`+sigil operators. */
        expect(keywordsOf(source)).toEqual([])
        const structural = templateSemanticTokens(source).filter(
            (t) => t.type === 'keyword' || (t.type === 'operator' && source[t.start] === '{'),
        )
        expect(structural).toEqual([])
    })

    test('colors the of/by connectors inside a for head', () => {
        expect(keywordsOf(`{#for frame of frames by frame.n}{/for}`)).toEqual([
            'for',
            'of',
            'by',
            'for',
        ])
    })

    test('does not color of/by nested in a destructure, call, or as an identifier', () => {
        expect(keywordsOf(`{#for x of pick({of: 1}).nearby by x.id}{/for}`)).toEqual([
            'for',
            'of',
            'by',
            'for',
        ])
    })
})

/* The known lexemes for each legend type, so a corpus token that drifts off its source
   span (a wrong start/length) is caught structurally without an external golden. */
const KEYWORD_LEXEMES = new Set<string>([
    ...BLOCK_OPENERS,
    ...BLOCK_CONNECTORS,
    'for await',
    'of',
    'by',
])
const OPERATOR_LEXEMES = new Set(['<', '>', '=', '/', '</', '/>', '{#', '{:', '{/'])

describe('templateSemanticTokens — corpus invariants', () => {
    const repoRoot = join(import.meta.dir, '../../..')
    const files: string[] = []
    for (const file of new Glob('**/*.abide').scanSync({ cwd: repoRoot, absolute: true })) {
        if (!file.includes('/node_modules/')) {
            files.push(file)
        }
    }
    files.sort()

    test('the corpus has real .abide files to check', () => {
        expect(files.length).toBeGreaterThan(50)
    })

    for (const file of files) {
        const key = file.slice(repoRoot.length + 1)
        test(`every emitted token matches its source lexeme — ${key}`, async () => {
            const text = await Bun.file(file).text()
            for (const token of templateSemanticTokens(text)) {
                const slice = text.slice(token.start, token.start + token.length)
                expect(token.length).toBeGreaterThan(0)
                if (token.type === 'keyword') {
                    expect(KEYWORD_LEXEMES.has(slice), `keyword "${slice}" @${token.start}`).toBe(
                        true,
                    )
                } else if (token.type === 'operator') {
                    expect(OPERATOR_LEXEMES.has(slice), `operator "${slice}" @${token.start}`).toBe(
                        true,
                    )
                } else if (token.type === 'comment') {
                    expect(slice.startsWith('<!--')).toBe(true)
                } else {
                    /* tag / type / attribute / string — a non-empty span already asserted. */
                    expect(['tag', 'type', 'attribute', 'string']).toContain(token.type)
                }
            }
        })
    }
})
