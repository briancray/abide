import { describe, expect, test } from 'bun:test'
import { markupTokens } from '../src/lib/ui/compile/markupTokens.ts'

/* The substring each emitted token covers, paired with its legend type. */
const spans = (source: string) =>
    markupTokens(source).map((token) => ({
        text: source.slice(token.start, token.start + token.length),
        type: token.type,
    }))

const typed = (source: string, type: string) =>
    spans(source)
        .filter((span) => span.type === type)
        .map((span) => span.text)

describe('markupTokens', () => {
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
        expect(typed(`<p id="x">`, 'operator')).toEqual(['<', '=', '>'])
    })

    test('colors an HTML comment, including multiline (one span)', () => {
        expect(typed(`<!-- hi -->`, 'comment')).toEqual(['<!-- hi -->'])
        expect(typed(`<!-- a\nb -->`, 'comment')).toEqual(['<!-- a\nb -->'])
    })

    test('skips an `{expr}` region — a `<` inside an expression is not a tag', () => {
        /* `{a < b}` must not be read as opening a `<b>` element: only the real
           `<p>`/`</p>` brackets are operators, the expression's `<` is not. */
        expect(typed(`<p>{a < b}</p>`, 'tag')).toEqual(['p', 'p'])
        expect(typed(`<p>{a < b}</p>`, 'operator')).toEqual(['<', '>', '</', '>'])
    })

    test('skips a brace attribute value without consuming the closing tag', () => {
        const source = `<a class={x}>z</a>`
        expect(typed(source, 'tag')).toEqual(['a', 'a'])
        expect(typed(source, 'attribute')).toEqual(['class'])
    })

    /* The reported regression: a multiline template-literal `{`...`}` attribute
       whose body holds literal `{ }` and a comment must not desync the scan —
       the element after it still gets a tag token. */
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

    test('does not scan `<script>` / `<style>` raw bodies as markup', () => {
        const source = `<script>\nconst t = a < b ? 1 : 2\n</script>\n<p>x</p>`
        /* The `<` in the script body is JS, not a tag; only the real <p> counts. */
        expect(typed(source, 'tag')).toEqual(['script', 'script', 'p', 'p'])
    })

    test('skips `{expr}` interpolations inside a quoted attribute value', () => {
        const source = `<p class="a {b} c">x</p>`
        /* The literal segments are strings; `{b}` is left to the shadow classifier. */
        expect(typed(source, 'string')).toEqual([`"a `, ` c"`])
    })
})
