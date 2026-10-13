// 34.4, 34.5 — A COMPONENT'S `<style>`, SCOPED: the rewrite on its own, and a built app whose markup
// and linked stylesheet carry it (spawned, for `serve.test.ts`'s reason).

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { compileApp } from '#compiler/compileApp.ts'
import { namesViewTransition, scopeCss } from '#compiler/scopeStyles.ts'
import { serveApp } from './builtApp.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

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

// A COMMENT IS NOT A COMBINATOR, and a newline is one. THE REVERT: count only a space, comments
// included; the last space is inside the comment, the compound reads `it. */\n:global(.y)`, and
// the rule the comment explains is scoped to `.y[a-t]` — dogfood's own `:global` example did this.
test('a comment on its own line ahead of a selector leaves the rightmost compound alone — 34.4, 34.5', () => {
    const scoped = (css: string) => scopeCss(css, 'a-t')
    expect(scoped('/* reaches\n   it. */\n:global(.y){x:y}')).toBe(
        '/* reaches\n   it. */\n.y{x:y}',
    )
    expect(scoped('.x\n.y{x:y}')).toBe('.x\n.y[a-t]{x:y}')
})

// 34.4 REACHES A NESTED RULE. `.card { .title {…} }` is `.card .title` to a browser, so a nested
// selector left as written styles a child component's `.title` inside the card; and a grouping
// at-rule the walk did not know was copied whole, so `@starting-style { .x {…} }` reached every
// `.x` in the document.
//
// THE REVERT: copy a qualified rule's body as written and drop `starting-style` and `scope` from
// `NESTING`. 5 of the 5 nested selectors below then carry no token.
test('a nested rule and a grouping at-rule require the token too — 34.4', () => {
    const scoped = (css: string) => scopeCss(css, 'a-t')
    expect(
        scoped('.card { color: red; .title { color: blue } & > p { x: y } }'),
    ).toBe(
        '.card[a-t] { color: red; .title[a-t] { color: blue } & > p[a-t] { x: y } }',
    )
    expect(scoped('.card { @media (x) { .title { x: y } } }')).toBe(
        '.card[a-t] { @media (x) { .title[a-t] { x: y } } }',
    )
    expect(scoped('@starting-style { .x { opacity: 0 } }')).toBe(
        '@starting-style { .x[a-t] { opacity: 0 } }',
    )
    expect(scoped('@scope (.card) { img { x: y } }')).toBe(
        '@scope (.card) { img[a-t] { x: y } }',
    )
    // A declaration's own `;` inside a value is not a statement's end.
    expect(scoped('.x { background: url("a;b{c}") }')).toBe(
        '.x[a-t] { background: url("a;b{c}") }',
    )
})

const CARD = `<script>
import { props } from '@abide/abide'

const { title } = props<{ title: string }>()
</script>

<article class="card"><h2>{title}</h2><slot/></article>

<style>
.card h2 { color: rebeccapurple }
:global(body) .card { margin: 0 }
</style>`

const PAGE = `<script>
import Card from '#src/lib/Card.abide'
</script>

<main><Card title="first"><p id="passed">from the page</p></Card></main>

<style>
main { padding: 1rem }
</style>`

let base = ''
let stop = (): void => {}

beforeAll(async () => {
    ;({ base, stop } = await serveApp({
        'index.abide': PAGE,
        'lib/Card.abide': CARD,
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

// 39.7 — A PROPERTY, A PSEUDO-ELEMENT OR THE AT-RULE turns view transitions on, and the same words
// in a comment, a string or a custom property's name do not. THE REVERT: test the stylesheet with
// `includes('view-transition')`; the four refusals below read true.
test('a stylesheet names a view transition by a rule, not by the words — 39.7', () => {
    expect(namesViewTransition('.total { view-transition-name: total }')).toBe(
        true,
    )
    expect(
        namesViewTransition(':global(::view-transition-old(root)) { a: b }'),
    ).toBe(true)
    expect(namesViewTransition('@view-transition { navigation: auto }')).toBe(
        true,
    )
    expect(
        namesViewTransition('/* view-transition-name: total */ .x { a: b }'),
    ).toBe(false)
    expect(
        namesViewTransition('.x::after { content: "view-transition" }'),
    ).toBe(false)
    expect(namesViewTransition('.x { --view-transition-name: total }')).toBe(
        false,
    )
    expect(namesViewTransition('.x { color: red }')).toBe(false)
})

// 39.8 — DECIDED BY THE BUILD, written into the route table the client boots from. THE REVERT:
// leave `transitions` false in `compileApp`; the styled app's table reads `startRouter(routes, host, false)`.
test('the build turns view transitions on from the compiled styles — 39.8', async () => {
    const app = (style: string) => ({
        'package.json': JSON.stringify({
            name: 'transition-fixture',
            type: 'module',
            imports: { '#src/*': './*' },
        }),
        'index.abide': `<main><p class="total">1</p></main>\n\n<style>\n${style}\n</style>`,
    })
    const on = await compileApp(
        temporaryModule(app('.total { view-transition-name: total }')),
    )
    const off = await compileApp(temporaryModule(app('.total { color: red }')))
    expect(on.tables['routes.ts']).toContain('startRouter(routes, host, true)')
    expect(off.tables['routes.ts']).toContain(
        'startRouter(routes, host, false)',
    )
})
