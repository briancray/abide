// 38.125-38.129 — `abide format`: every piece of a `.abide` that is code formatted by `bun fmt` under
// the options it reads for the file, the markup indented by its nesting, and nothing the parser
// reads changed. Each fixture carries its own `[fmt]`, so what is printed is what that config asks
// for rather than whatever a directory above the repo holds.

import { afterAll, expect, test } from 'bun:test'
import { tmpdir } from 'node:os' // bun exposes no temporary directory of its own

import { spawned } from '@abide/harness/gate'

import { formatAbide, type Formatted } from '#compiler/formatAbide.ts'
import { parseAbide } from '#compiler/parseAbide.ts'
import { sameTemplate } from '#compiler/sameTemplate.ts'

import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const BIN = new URL('../bin/abide.ts', import.meta.url).pathname

const FMT = `[fmt]
semi = false
singleQuote = true
tabWidth = 4
`

// OUTSIDE THE REPO, where `temporaryModule` is not by default: `.test-modules` is gitignored, and
// `bun fmt` hands an ignored file back as it stands, so every fixture there formatted to itself.
const OUTSIDE_REPO = `${tmpdir()}/`
afterAll(removeTemporaryModules)

async function formatted(text: string): Promise<Formatted> {
    const app = temporaryModule(
        { 'bunfig.toml': FMT, 'index.abide': text },
        OUTSIDE_REPO,
    )
    return await formatAbide(`${app}/index.abide`, text)
}

// THE REVERT: hand the script and the style back as written; neither moves.
test('a script block and a style are formatted by bun fmt under the options it reads — 38.125', async () => {
    const { text, findings } = await formatted(`<script>
import {reactive} from "@abide/abide";
let count=reactive(0);
</script>

<p>{count}</p>

<style>
p{color:red;margin:0 0}
</style>
`)
    expect(findings).toEqual([])
    expect(text).toBe(`<script>
import { reactive } from '@abide/abide'
let count = reactive(0)
</script>

<p>{count}</p>

<style>
p {
    color: red;
    margin: 0 0;
}
</style>
`)
})

// THE REVERT: skip the expression batch; every slot, attribute and head keeps its spacing.
test('every expression a slot, an attribute, a spread or a block head holds is formatted — 38.126', async () => {
    const { text, findings } = await formatted(`<div {...rest}>
    {#if count>1}
        <p title={count+1}>{ count*2 }</p>
    {:else if count===1}
        <p>one</p>
    {/if}
    {#for item,index of items.filter(x=>x.ok) by item.id}
        <b>{index}</b>
    {/for}
</div>
`)
    expect(findings).toEqual([])
    expect(text).toBe(`<div {...rest}>
    {#if count > 1}
        <p title={count + 1}>{count * 2}</p>
    {:else if count === 1}
        <p>one</p>
    {/if}
    {#for item, index of items.filter((x) => x.ok) by item.id}
        <b>{index}</b>
    {/for}
</div>
`)
})

// THE REVERT: drop the `fit` check; `'b'` lands inside `class='…'` and the attribute ends there.
test('an expression the printer would let out of its attribute value is kept as written — 38.126', async () => {
    const { text } =
        await formatted(`<p class='a {on?"b":"c"}' data-x=x{n+1}>x</p>
`)
    expect(text).toBe(`<p class='a {on?"b":"c"}' data-x=x{n+1}>x</p>
`)
})

// THE REVERT: indent every break by depth alone; the `else` arm is indented under its own block.
test('the markup is indented by its element and block nesting — 38.127', async () => {
    const { text } = await formatted(`<main>
<section>
<h1>Title</h1>
</section>
        {#if on}
  <p>on</p>
      {:else}
<p>off</p>
            {/if}
</main>
`)
    expect(text).toBe(`<main>
    <section>
        <h1>Title</h1>
    </section>
    {#if on}
        <p>on</p>
    {:else}
        <p>off</p>
    {/if}
</main>
`)
})

// THE REVERT: drop `keepsKind`; the second span gains indentation, so 33.17 no longer drops the
// newline between the two and the page grows a space it never had.
test('a run 33.17 drops between two nodes gains no indentation — 38.127', async () => {
    const source = `<p>
    <span>a</span>
<span>b</span>
</p>
`
    const { text } = await formatted(source)
    expect(text).toBe(source)
    expect(parseAbide(text).template).toEqual(parseAbide(source).template)
})

// THE REVERT: indent the lines of a printed expression without asking the scanner where its
// template literals are; the second line of the string moves and the value changes with it.
test('a <pre>, and the lines of a template literal, stay as written — 38.127', async () => {
    const { text } = await formatted(`<div>
<p>{\`one
two\`}</p>
<pre>
  keep   this
</pre>
</div>
`)
    expect(text).toBe(`<div>
    <p>{\`one
two\`}</p>
<pre>
  keep   this
</pre>
</div>
`)
})

// THE REVERT: have `sameTemplate` answer `true`; the three changes the emitter's own guards keep it
// from making read as the template they are not.
test('a file that would parse to a different template is told apart from one re-indented — 38.127', () => {
    const same = (before: string, after: string) =>
        sameTemplate(parseAbide(before), parseAbide(after))
    expect(
        same(
            `<script>\nimport b from './b.ts'\nimport a from './a.ts';\n</script>\n<div>\n<p>{ f(a,b) }</p>\n</div>\n`,
            `<script>\n    import a from './a.ts'\n    import b from './b.ts'\n</script>\n<div>\n    <p>{f(a, b)}</p>\n</div>\n`,
        ),
    ).toBe(true)
    // A whitespace run between two nodes that gains indentation is one 33.17 no longer drops.
    expect(
        same(`<p><b>a</b>\n<b>b</b></p>\n`, `<p><b>a</b>\n    <b>b</b></p>\n`),
    ).toBe(false)
    // A line moved inside a template literal is a different string.
    expect(same('<p>{`one\ntwo`}</p>\n', '<p>{`one\n    two`}</p>\n')).toBe(
        false,
    )
    expect(same('<a title="x y">a</a>\n', '<a title="x  y">a</a>\n')).toBe(
        false,
    )
})

// THE REVERT: return the batch's refusal for the whole file; the slot that parses is left as
// written too.
test('a piece bun fmt refuses is kept as written and reported on its line, and the rest formatted — 38.128', async () => {
    const { text, findings } = await formatted(`<script>
let a = (
</script>

<p>{ b+1 }</p>
<p>{ c + }</p>
`)
    expect(text).toBe(`<script>
let a = (
</script>

<p>{b + 1}</p>
<p>{ c + }</p>
`)
    expect(findings.map((finding) => finding.line)).toEqual([6, 2])
})

test('a file the parser refuses is kept as written — 38.128', async () => {
    const source = `<script lang="ts">let a = 1</script>\n`
    const { text, findings } = await formatted(source)
    expect(text).toBe(source)
    expect(findings).toHaveLength(1)
})

test('a formatted file formats to itself', async () => {
    const first = await formatted(`<main>
<ul>
{#for item of items}<li class={item.on?'on':'off'}>{item.name}</li>{/for}
</ul>
<button onclick={() => { count = count + 1 }}>+</button>
</main>
`)
    const second = await formatted(first.text)
    expect(second.text).toBe(first.text)
})

// THE REVERT: drop `ignoredByConfig`; the generated page is reformatted under its generator.
test('a file the [fmt] ignorePatterns name is kept as written — 38.125', async () => {
    const source = '<p>{ a+1 }</p>\n'
    const app = temporaryModule(
        {
            'bunfig.toml': `${FMT}ignorePatterns = ["generated/"]\n`,
            'generated/index.abide': source,
        },
        OUTSIDE_REPO,
    )
    expect(
        (await formatAbide(`${app}/generated/index.abide`, source)).text,
    ).toBe(source)
    expect((await formatAbide(`${app}/index.abide`, source)).text).toBe(
        '<p>{a + 1}</p>\n',
    )
})

// THE REVERT: write the file under `--check`; the source on disk is the formatted one.
test('`abide format --check` writes nothing and fails where a file would change — 38.129', async () => {
    const source = '<p>{ a+1 }</p>\n'
    const app = temporaryModule(
        { 'bunfig.toml': FMT, 'index.abide': source },
        OUTSIDE_REPO,
    )
    const checked = await spawned([
        'bun',
        BIN,
        'format',
        '--check',
        '--root',
        app,
    ])
    expect(checked.exitCode).toBe(1)
    expect(await Bun.file(`${app}/index.abide`).text()).toBe(source)
    const written = await spawned(['bun', BIN, 'format', '--root', app])
    expect(written.exitCode).toBe(0)
    expect(await Bun.file(`${app}/index.abide`).text()).toBe('<p>{a + 1}</p>\n')
}, 30_000)
