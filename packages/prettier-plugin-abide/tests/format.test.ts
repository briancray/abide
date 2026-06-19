import { describe, expect, test } from 'bun:test'
import prettier from 'prettier'
import plugin from '../src/index.ts'

/* Formats a `.abide` source through the plugin with the repo's style (mirrors
   prettier.config.mjs) so tests assert the same output the `format` script yields. */
function format(source: string): Promise<string> {
    return prettier.format(source, {
        parser: 'abide',
        plugins: [plugin],
        printWidth: 100,
        tabWidth: 4,
        semi: false,
        singleQuote: true,
        trailingComma: 'all',
        arrowParens: 'always',
    })
}

describe('prettier-plugin-abide', () => {
    test('reflows template markup — indents children under their parent', async () => {
        const out = await format(
            `<Layout>\n<template then="x">\n<h1>{a}</h1>\n</template>\n</Layout>\n`,
        )
        expect(out).toContain('    <template then="x">')
        expect(out).toContain('        <h1>{a}</h1>')
    })

    test('keeps inline elements inline within text', async () => {
        const out = await format(`<p>Edit <code>file.abide</code> and reload.</p>\n`)
        expect(out).toContain('<p>Edit <code>file.abide</code> and reload.</p>')
    })

    test('formats the leading <script> as TypeScript', async () => {
        const out = await format(
            `<script>\nimport {cache}   from 'x'\nconst   a=1\n</script>\n<p>hi</p>\n`,
        )
        expect(out).toContain("import { cache } from 'x'")
        expect(out).toContain('const a = 1')
    })

    test('formats nested reactive <script> blocks, indented in place', async () => {
        const out = await format(`<div>\n<script>let   n=2;const o={a:1}</script>\n</div>\n`)
        expect(out).toContain('    <script>')
        expect(out).toContain('    let n = 2')
        expect(out).toContain('    const o = { a: 1 }')
        expect(out).toContain('    </script>')
    })

    test('formats <style> as CSS', async () => {
        const out = await format(`<style>.x{color:red;background:blue}</style>\n`)
        expect(out).toContain('color: red;')
        expect(out).toContain('background: blue;')
    })

    test('formats and normalises braces of a text interpolation', async () => {
        const out = await format(`<h1>{   hello.message   }</h1>\n`)
        expect(out).toContain('<h1>{hello.message}</h1>')
    })

    test('formats attribute and event expressions, kept inline', async () => {
        const out = await format(`<button onclick={( )=>doThing(  x )} title={a?b:c}>go</button>\n`)
        expect(out).toContain('onclick={() => doThing(x)}')
        expect(out).toContain('title={a ? b : c}')
    })

    test('a long expression stays on one line rather than spilling into markup', async () => {
        const long =
            'someObject.someMethod(argumentOne, argumentTwo, argumentThree, argumentFour, argumentFive)'
        const out = await format(`<p>{${long}}</p>\n`)
        expect(out).toContain(`{${long}}`)
        expect(out.split('\n').filter((line) => line.includes('argumentFive'))).toHaveLength(1)
    })

    test('leaves braces inside a quoted attribute value untouched', async () => {
        const out = await format(`<a title="hi {there}" data-x="a{b}c">x</a>\n`)
        expect(out).toContain('title="hi {there}"')
        expect(out).toContain('data-x="a{b}c"')
    })

    test('preserves HTML comments', async () => {
        const out = await format(`<div>\n<!-- a {comment} -->\n<p>x</p>\n</div>\n`)
        expect(out).toContain('<!-- a {comment} -->')
    })

    test('leaves an empty {} alone (not an expression)', async () => {
        const out = await format(`<p>before {} after</p>\n`)
        expect(out).toContain('before {} after')
    })

    test('falls back to original bytes on an unparseable expression', async () => {
        const out = await format(`<p>{a +}</p>\n`)
        expect(out).toContain('{a +}')
    })

    test('keeps a multi-statement block handler verbatim, not dedented', async () => {
        const out = await format(`<button onclick={() => { a(); b() }}>x</button>\n`)
        expect(out).toContain('onclick={() => { a(); b() }}')
    })

    test('expression keeping a string literal with > and { intact', async () => {
        const out = await format(`<p>{cond ? "a>b" : '{z}'}</p>\n`)
        expect(out).toContain(`{cond ? 'a>b' : '{z}'}`)
    })

    test('is idempotent', async () => {
        const source = `<Layout>\n<script>\nconst a=1\n</script>\n<button onclick={()=>f(x)}>{label}</button>\n<style>.y{margin:0}</style>\n</Layout>\n`
        const once = await format(source)
        expect(await format(once)).toBe(once)
    })

    test('preserves component tags whose name collides with an HTML element', async () => {
        // The HTML pass lowercases recognized tag names; a `<Button>`/`<Input>`
        // component must survive as-authored, not decay into a dead native element.
        const out = await format(`<Button href={x}>\n<Input value={y} />\n</Button>\n`)
        expect(out).toContain('<Button href={x}>')
        expect(out).toContain('<Input value={y} />')
        expect(out).not.toContain('<button')
        expect(out).not.toContain('<input')
    })

    test('is idempotent for an HTML-named component near the print width', async () => {
        const source = `<Modal open={searching} close={() => (searching = false)} class="relative w-xl">\n<Button href={url('/media')} color="stone" size="md">{label}</Button>\n</Modal>\n`
        const once = await format(source)
        expect(await format(once)).toBe(once)
    })
})
