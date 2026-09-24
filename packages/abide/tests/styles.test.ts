// 34.4, 34.5 — A COMPONENT'S `<style>`, SCOPED: the rewrite on its own, and a built app whose markup
// and linked stylesheet carry it (spawned, for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { scopeCss } from '#compiler/scopeStyles.ts'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'

// 34.4 — THE RIGHTMOST COMPOUND REQUIRES THE TOKEN, ahead of a pseudo-element; 34.5 — `:global(…)`
// is unwrapped and exempts its compound. THE REVERT: append the token to every compound; the
// descendant selector requires it on `.card` as well, and the list below reads `.card[a-t] p[a-t]`.
test('every selector requires the token on its rightmost compound — 34.4, 34.5', () => {
    const scoped = (css: string) => scopeCss(css, 'a-t')
    expect(scoped('.card p { color: red }')).toBe('.card p[a-t] { color: red }')
    expect(scoped('a:hover, b::before{x:y}')).toBe(
        'a:hover[a-t], b[a-t]::before{x:y}',
    )
    expect(scoped('p:after{x:y}')).toBe('p[a-t]:after{x:y}')
    expect(scoped(':global(body) .x > .y{x:y}')).toBe('body .x > .y[a-t]{x:y}')
    expect(scoped('.x :global(.y){x:y}')).toBe('.x .y{x:y}')
    expect(scoped('@media (min-width: 40em) { .x { a: b } }')).toBe(
        '@media (min-width: 40em) { .x[a-t] { a: b } }',
    )
    expect(
        scoped('@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }'),
    ).toBe('@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }')
    expect(scoped('input[type="a,b"] {x:y}')).toBe(
        'input[type="a,b"][a-t] {x:y}',
    )
})

const CARD = `<script>
import { props } from 'abide'

const { title } = props<{ title: string }>()
</script>

<article class="card"><h2>{title}</h2><slot/></article>

<style>
.card h2 { color: rebeccapurple }
:global(body) .card { margin: 0 }
</style>`

const PAGE = `<script>
import Card from '#ui/components/Card.abide'
</script>

<main><Card title="first"><p id="passed">from the page</p></Card></main>

<style>
main { padding: 1rem }
</style>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'ui/pages/page.abide': PAGE,
        'ui/components/Card.abide': CARD,
    }))
}, 30_000)

afterAll(() => {
    stop()
    removeTemporaryModules()
})

// 34.4 — EACH COMPONENT'S ELEMENTS CARRY ITS OWN TOKEN, and markup a caller passes between a child's
// tags carries the CALLER's; the linked stylesheet holds both components' rules, scoped.
test("each component's elements carry its token, and the stylesheet is scoped — 34.4", async () => {
    const html = await (await Bun.fetch(`${base}/`)).text()
    const card = /<article class="card" (a-[a-z0-9]+)>/.exec(
        html,
    )?.[1] as string
    const page = /<main (a-[a-z0-9]+)>/.exec(html)?.[1] as string
    expect(card).toBeDefined()
    expect(page).toBeDefined()
    expect(card).not.toBe(page)
    expect(html).toContain(`<h2 ${card}>first</h2>`)
    expect(html).toContain(`<p id="passed" ${page}>from the page</p>`)

    const sheet = /href="(\/__abide\/client\/[^"]+\.css)"/.exec(
        html,
    )?.[1] as string
    const css = await (await Bun.fetch(`${base}${sheet}`)).text()
    expect(css).toContain(`h2[${card}]`)
    expect(css).toContain(`main[${page}]`)
    expect(css).not.toContain(':global')
})
