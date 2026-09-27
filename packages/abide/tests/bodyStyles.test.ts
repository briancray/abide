// 34.13 — A `<style>` INSIDE A BLOCK IS SCOPED TO THAT BODY. Its elements carry a token of their own
// beside the component's, its rules require that token, and an element of the same kind anywhere else
// in the component is untouched by them. Served, so what is asserted is the markup and the stylesheet
// a browser is actually handed.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { parseAbide } from '#compiler'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

const PAGE = `<script>
import { reactive } from 'abide'

let open = reactive(true)
let rows = reactive(['ada', 'grace'])
</script>

<main>
{#if open}<style>p { color: red }</style><p id="inside">in the arm</p>{/if}
<p id="outside">beside it</p>
<ul>{#for row of rows}<style>li { color: blue }</style><li>{row}</li>{/for}</ul>
</main>

<style>
main { padding: 1rem }
</style>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({ 'ui/pages/page.abide': PAGE }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// THE REVERT: drop the body arm from `markScoped` (never add a body's token); the stylesheet still
// requires `[a-…-0]`, which no element carries, and `#inside` is left with the component's token alone.
test("a body's style reaches that body's elements and no other the component wrote", async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    const page = /<main (a-[a-z0-9]+)>/.exec(html)?.[1] as string
    expect(page).toBeDefined()
    const arm = `${page}-0`
    const row = `${page}-1`
    // Each carries the component's token, and the arm's and the row's elements their own beside it.
    expect(html).toContain(`<p id="inside" ${page} ${arm}>`)
    expect(html).toContain(`<p id="outside" ${page}>`)
    expect(html).toContain(`<li ${page} ${row}>ada</li>`)

    const sheet = /href="(\/__abide\/client\/[^"]+\.css)"/.exec(
        html,
    )?.[1] as string
    const css = await (await Bun.fetch(`${base}${sheet}`)).text()
    // The component's rule, and each body's scoped to that body's token alone.
    expect(css).toContain(`main[${page}]`)
    expect(css).toContain(`p[${arm}]`)
    expect(css).toContain(`li[${row}]`)
    expect(css).not.toContain(`p[${page}]`)
})

test('a style inside a {#try} is refused', () => {
    expect(() =>
        parseAbide('{#try}<style>p { color: red }</style><p>x</p>{/try}'),
    ).toThrow('34.12')
})
