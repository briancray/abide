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

    test('indents a control-flow block body, markers kept at the parent level', async () => {
        const out = await format(
            `<section>\n<h2>title</h2>\n{#await cachedRaw}\n<p>loading</p>\n{:then response}\n<p>status={response.status}</p>\n{/await}\n</section>\n`,
        )
        expect(out).toContain('    <h2>title</h2>')
        expect(out).toContain('    {#await cachedRaw}')
        expect(out).toContain('        <p>loading</p>')
        expect(out).toContain('    {:then response}')
        expect(out).toContain('        <p>status={response.status}</p>')
        expect(out).toContain('    {/await}')
    })

    test('indents nested control-flow blocks, each marker at its own level', async () => {
        const out = await format(
            `<ul>\n{#each items as item}\n<li>\n{#if item.active}\n<span>{item.name}</span>\n{/if}\n</li>\n{/each}\n</ul>\n`,
        )
        expect(out).toContain('    {#each items as item}')
        expect(out).toContain('        <li>')
        expect(out).toContain('            {#if item.active}')
        expect(out).toContain('                <span>{item.name}</span>')
        expect(out).toContain('            {/if}')
        expect(out).toContain('        </li>')
        expect(out).toContain('    {/each}')
    })

    test('keeps every branch of an {:else if} chain at the block level', async () => {
        const out = await format(
            `{#if a}\n<p>A</p>\n{:else if b}\n<p>B</p>\n{:else}\n<p>C</p>\n{/if}\n`,
        )
        expect(out).toContain('{#if a}\n    <p>A</p>')
        expect(out).toContain('{:else if b}\n    <p>B</p>')
        expect(out).toContain('{:else}\n    <p>C</p>')
        expect(out).toContain('{/if}')
    })

    test('normalises the head expression of a control-flow block', async () => {
        const out = await format(
            `{#each items.filter(  (x)=>x.on )   as item}\n<p>{item}</p>\n{/each}\n`,
        )
        expect(out).toContain('{#each items.filter((x) => x.on) as item}')
    })

    test('preserves an inline control-flow block within text', async () => {
        const out = await format(`<p>Hello {#if name}{name}{:else}there{/if}!</p>\n`)
        expect(out).toContain('{#if name}')
        expect(out).toContain('{:else}')
        expect(out).toContain('{/if}')
    })

    test('is idempotent for control-flow blocks', async () => {
        const source = `<section>\n{#await p}\n<p>loading</p>\n{:then v}\n<p>{v}</p>\n{:catch e}\n<p>{e.message}</p>\n{/await}\n</section>\n`
        const once = await format(source)
        expect(await format(once)).toBe(once)
    })

    test('is idempotent for a multi-line block comment in a nested script', async () => {
        // Prettier copies a block comment's interior verbatim; re-indenting it each
        // pass used to compound its leading whitespace. The continuation must hold.
        const source = `<Layout>\n<div>\n<script>\nconst a = 1\n/* first line\n   second line stays put */\neffect(() => f(a))\n</script>\n</div>\n</Layout>\n`
        const once = await format(source)
        expect(once).toContain('   second line stays put */')
        expect(await format(once)).toBe(once)
    })
})
