// 32.39 TO 32.55 — `{#component Name(pattern)}`, A COMPONENT DECLARED WHERE IT IS USED. It is a
// function declared in the body it is written in, so it closes over every name in scope there, and
// it is invoked as a file component is. What is asserted is the work as well as the markup: the
// server renders it where it is invoked, the client hydrates it without making a node, and a read
// of the page's own value wakes one binding inside it — counted, not compared.

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { parseAbide } from '#compiler'
import { UNCHECKED } from '#compiler/CheckerAnswer.ts'
import { checkApp } from '#compiler/checkApp.ts'
import { compileApp } from '#compiler/compileApp.ts'
import { flushSync } from '#shared'
import { appFixture } from './builtApp.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, renderPage, TYPED_ROOT, typedSession } from './typed.ts'

afterAll(closeTyped)
const session = await typedSession()
afterAll(removeTemporaryModules)

const click = (selector: string): void => {
    ;(document.querySelector(selector) as HTMLElement).click()
    flushSync()
}

// 32.42 — THE PAGE'S OWN VALUE, read by name inside the body, with no prop to carry it.
const COUNTER = `<script>
import { reactive } from '@abide/abide'

let count = reactive(1)
</script>

{#component Shown()}
<b>{count}</b>
{/component}

<p><Shown/><Shown/></p>
<button onclick={() => { count = count + 1 }}>+</button>`

// THE REVERTS: declare the template's components nowhere (`definitions` answering '' in
// `emitComponent`) — the render throws `Shown is not defined`; or keep an inline component's units
// out of its mount (`clientComponent` emitting no `bindings`) — the click moves `count`, the text
// stays `1`, and wakes is 0.
test("an inline component reads its file's script by name, live — 32.42, 31.2", async () => {
    const { html, mount } = await renderPage(COUNTER)
    expect(html).toContain(
        '<p><!--[--><b>1</b><!--]--><!--[--><b>1</b><!--]--></p>',
    )

    const hydrated = measure(mount)
    expect(hydrated.nodesCreated).toBe(0)

    const [first, second] = document.querySelectorAll('b')
    const text = (first as Element).firstChild
    const work = measure(() => click('button'))
    expect((first as Element).textContent).toBe('2')
    expect((second as Element).textContent).toBe('2')
    // Written in place: the text node the server wrote, and no node made or moved.
    expect((first as Element).firstChild).toBe(text)
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
    // One binding per invocation, and nothing else reads `count`.
    expect(work.wakes).toBe(2)
})

// 10.5, 32.46 — EACH INVOCATION IS AN INSTANCE, AND OPENS ITS OWN SHARE SCOPE, as two file
// components side by side do: `reactive.share` in one creates where no ancestor holds the key
// (10.6), and the sibling cannot see it. THE REVERT: drop `shareScope` from `clientComponent` and
// `serverComponent` — both counters are one value, so a click on the first moves the second too.
test('two inline instances each share their own value — 10.5, 32.46', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'
</script>

{#component Counter({ name })}<script>
let count = reactive.share('count', () => reactive(0))
</script><button id={name} onclick={() => { count = count + 1 }}>{count}</button>{/component}

<Counter name="first"/><Counter name="second"/>`)
    expect(html).toContain('>0</button>')
    mount()
    click('#first')
    click('#first')
    expect(document.querySelector('#first')?.textContent).toBe('2')
    expect(document.querySelector('#second')?.textContent).toBe('0')
})

// 32.41, 32.42 — DECLARED IN A ROW, IT CLOSES OVER THE ROW: each invocation reads its own row's
// item. A row the browser grows is filled by the component itself (32.17). THE REVERTS: leave a
// row's components out of the loop body on the server (`definitions` off the row's `setup`) — the
// render throws `Cell is not defined`; or out of the row's mount on the client (`emitRegion`
// declaring nothing in a repeated region) — hydration throws it.
test('an inline component declared in a {#for} row reads the row — 32.41, 32.42', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let rows = reactive([{ id: 1, name: 'one' }, { id: 2, name: 'two' }])
</script>

<ul>{#for row of rows by row.id}{#component Cell()}<b>{row.name}</b>{/component}<li><Cell/></li>{/for}</ul>
<button onclick={() => { rows = [...rows, { id: 3, name: 'three' }] }}>+</button>`)
    expect(html).toContain(
        '<li><!--[--><b>one</b><!--]--></li><li><!--[--><b>two</b><!--]--></li>',
    )
    expect(measure(mount).nodesCreated).toBe(0)

    const grown = measure(() => click('button'))
    expect(
        [...document.querySelectorAll('li')].map((li) => li.textContent),
    ).toEqual(['one', 'two', 'three'])
    // The row's `<li>`, its two anchors, and the `<b>` and its text the component fills them with.
    expect(grown.nodesCreated).toBe(5)
})

// 32.41, 32.43 — DECLARED INSIDE AN ELEMENT, it is its body's, and invocable before where it is
// written; DECLARED IN AN ARM, it closes over the page and is built with the arm. THE REVERT: file
// a component written inside an ordinary element on nothing (`collect` skipping `declared` for an
// element's own list) — `Mark` is unbound and the render throws.
test('an inline component declared in an element and in an {#if} arm — 32.41, 32.43', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let open = reactive(false)
let label = reactive('shut')
</script>

<Mark/><div>{#component Mark()}<i>mark</i>{/component}</div>
{#if open}{#component Said()}<em>{label}</em>{/component}<Said/>{/if}
<button id="open" onclick={() => { open = true }}>open</button>
<button id="label" onclick={() => { label = 'open' }}>label</button>`)
    expect(html).toContain('<!--[--><i>mark</i><!--]--><div></div>')
    expect(measure(mount).nodesCreated).toBe(0)

    click('#open')
    expect(document.querySelector('em')?.textContent).toBe('shut')
    const em = document.querySelector('em')
    const work = measure(() => click('#label'))
    expect(document.querySelector('em')).toBe(em)
    expect(em?.textContent).toBe('open')
    expect(work.nodesCreated).toBe(0)
    expect(work.wakes).toBe(1)
})

// 32.50, 32.52 — WRITTEN BETWEEN AN INVOCATION'S TAGS, it is the prop of its name: the child
// invokes it by that name, hands it props of its own, and what else stands between the tags is
// still the child's `<slot/>`. It closes over the caller, so a write there reaches it in place.
const OUTER = `<script>
import { props } from '@abide/abide'

const { Item, title } = props<{ Item: (props: { n: number }) => unknown; title: string }>()
</script>

<section><h2>{title}</h2><ol><Item n={1}/><Item n={2}/></ol><slot/></section>`

// THE REVERTS: pass nothing for it (`invocationProps` skipping `node.passed`), or file nothing as
// passed (`fileComponents` leaving `passed` empty) — either way `Item` is absent in `Outer`, and
// both of its positions render the empty pair (32.36).
test('an inline component written between the tags is passed as a prop — 32.50, 32.52', async () => {
    const { html, mount } = await renderPage(
        `<script>
import { reactive } from '@abide/abide'
import Outer from './Outer.abide'

let unit = reactive('kg')
</script>

<Outer title="Weights">{#component Item({ n }: { n: number })}<li>{n} {unit}</li>{/component}<p>after</p></Outer>
<button onclick={() => { unit = 'lb' }}>lb</button>`,
        { Outer: OUTER },
    )
    expect(html).toContain(
        '<section><h2>Weights</h2><ol><!--[--><li>1 kg</li><!--]--><!--[--><li>2 kg</li><!--]--></ol><!--[--><p>after</p><!--]--></section>',
    )
    expect(measure(mount).nodesCreated).toBe(0)

    const items = document.querySelectorAll('li')
    const work = measure(() => click('button'))
    expect([...document.querySelectorAll('li')]).toEqual([...items])
    expect((items[1] as Element).textContent).toBe('2 lb')
    expect(work.nodesCreated).toBe(0)
    expect(work.wakes).toBe(2)
})

// 32.18 — `<slot/>` IN AN INLINE COMPONENT is a file component's: the caller's markup, or the
// fallback. THE REVERT: give an inline component no record (`clientComponent` and `serverComponent`
// taking `__root` alone) — the render throws on the `__props` the slot reads its children from.
test('children render into an inline component slot, and the fallback where none were passed — 32.18', async () => {
    const { html } = await renderPage(`<Panel><b>given</b></Panel><Panel/>
{#component Panel()}
<section><slot>empty</slot></section>
{/component}`)
    expect(html).toContain(
        '<section><!--[--><b>given</b><!--]--></section><!--]--><!--[--><section><!--[-->empty<!--]--></section>',
    )
})

// 32.44, 32.46 — its own `<script>` is its per-instance setup, and it invokes itself. THE REVERT:
// drop the component's setup from `serverComponent`; `label` is unbound and the render throws.
test('an inline component sets itself up and invokes itself — 32.44, 32.46', async () => {
    const { html } =
        await renderPage(`{#component Nest({ depth }: { depth: number })}
<script>
const label = 'level ' + depth
</script>
<i>{label}{#if depth > 1}<Nest depth={depth - 1}/>{/if}</i>
{/component}
<Nest depth={2}/>`)
    expect(html).toContain(
        '<i>level 2<!--[0--><!--[--><i>level 1<!--[--><!--]--></i><!--]--><!--]--></i>',
    )
})

// 38.39 — A HOVER INSIDE THE BLOCK IS ANSWERED, from the file's own projection, where the body is
// typed. THE REVERT: project no inline component (`declare` doing nothing); `diagnose` reports
// `Price` unbound (TS2304) and nothing in the body is typed.
test('a hover inside an inline component is answered — 38.39', async () => {
    const page = `{#component Price({ amount }: { amount: number })}
<b>{amount.toFixed(2)}</b>
{/component}
<Price amount={3}/>`
    const path = `${TYPED_ROOT}src/Hover.abide`
    const file = parseAbide(page)
    const { answers } = await session.readsFor([{ path, text: page, file }])
    const { diagnoses } = await session.diagnose(
        [{ path, text: page, file, answer: answers[0] ?? UNCHECKED }],
        TYPED_ROOT,
        false,
    )
    expect(diagnoses).toEqual([])
    const hover = await session.inspect(path, page, page.indexOf('toFixed'))
    expect(hover?.signature).toContain('(method) toFixed(')
})

// THE REVERT: drop the `isComponentTag` refusal in `inlineComponent`; the file parses, and the
// `<row/>` that would invoke it is written as an element.
test('an inline component named in lowercase is refused — 32.39', () => {
    expect(() =>
        parseAbide('{#component row({ label })}<li>{label}</li>{/component}'),
    ).toThrow(/\{#component row\} is not TitleCase.*RULEBOOK 32\.39/)
})

// 32.49, 32.55 — ONE NAME, TWO THINGS, IN ONE SCOPE. THE REVERTS: drop `refuseTwice` from `open`, then
// `refuseImported`, then `refuseDeclared` — each file below then parses and reads, and the module
// emitted for it declares the name twice.
test('an inline component named as another in its body, an import or a script name is refused — 32.49, 32.55', async () => {
    expect(() =>
        parseAbide(
            '{#if on}{#component Row()}<li/>{/component}<p>{#component Row()}<b/>{/component}</p>{/if}',
        ),
    ).toThrow('{#component Row} is declared twice in one body')
    expect(() =>
        parseAbide(`<script>
import Row from './Row.abide'
</script>
{#component Row({ label })}<li>{label}</li>{/component}`),
    ).toThrow(
        "{#component Row} is declared inline and Row is also imported from './Row.abide'",
    )
    const page = `<script>
import { props } from '@abide/abide'

const { Row } = props<{ Row: string }>()
</script>
{#component Row()}<li/>{/component}`
    let refused = ''
    try {
        await session.readsFor([
            {
                path: `${TYPED_ROOT}src/Twice.abide`,
                text: page,
                file: parseAbide(page),
            },
        ])
    } catch (thrown) {
        refused = (thrown as Error).message
    }
    expect(refused).toContain(
        "{#component Row} is declared inline and `Row` is also declared by its file's script",
    )
    // A body inside another is a scope of its own, and its name shadows the outer one.
    expect(() =>
        parseAbide(
            '{#component Row()}<li/>{/component}{#if on}{#component Row()}<b/>{/component}<Row/>{/if}',
        ),
    ).not.toThrow()
})

// 32.53 — THE PROP GIVEN TWICE. THE REVERT: drop the attribute walk from `collect`; the record
// carries `Item` twice and the component between the tags silently wins.
test('an invocation given a prop both ways is refused — 32.53', () => {
    expect(() =>
        parseAbide(
            '<Outer Item={x}>{#component Item()}<li/>{/component}</Outer>',
        ),
    ).toThrow(
        /<Outer> is given Item as an attribute and as the \{#component Item\}.*RULEBOOK 32\.53/,
    )
})

let app = ''

beforeAll(async () => {
    app = appFixture({
        'index.abide': `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
</script>

{#component Row({ label }: { label: string })}
<li class="row">{label}</li><style>li { font-weight: bold }</style>
{/component}

<ul><Row label={count}/><Row label="fine"/></ul>

<style>
.row { color: red }
</style>`,
        'lib/Outer.abide': OUTER,
        'passed/index.abide': `<script>
import Outer from '../lib/Outer.abide'
</script>

<Outer title="t">{#component Item({ n }: { n: string })}<li>{n}</li>{/component}</Outer>
<Outer title="u">{#component Item({ n }: { n: number })}<li>{n}</li>{/component}</Outer>
<Item n={1}/>`,
    })
}, 60_000)

// 38.40, 32.54 — A TAG IS HELD TO THE PROPS ITS PATTERN'S ANNOTATION DECLARES, and a component passed
// between the tags to the type its receiver declares for it, each on the file's own line; and a
// component passed is in scope nowhere after the tag (32.51). THE REVERTS: key the record on no
// passed component (`invocation` skipping `node.passed`) — each `<Outer>` reports `Item` missing
// (TS2741) and the `n: string` mismatch is not; or declare the passed components without braces
// around the call — `<Item n={1}/>` after the tags resolves, and two `Item`s collide (TS2393).
test('abide check holds an inline component to its props and a passed one to its receiver — 32.40, 32.51, 32.54, 38.40', async () => {
    const found = await checkApp(app)
    const reported: {
        path: string
        line: number
        column: number
        code: number
    }[] = []
    for (const { path, line, column, code } of found)
        reported.push({ path: path.slice(app.length), line, column, code })
    expect(reported).toEqual([
        { path: '/index.abide', line: 11, column: 17, code: 2322 },
        {
            path: '/passed/index.abide',
            line: 5,
            column: 30,
            code: 2322,
        },
        { path: '/passed/index.abide', line: 7, column: 2, code: 2304 },
    ])
})

// 32.45, 32.47 — THE FILE'S `<style>` REACHES THE ELEMENTS ITS INLINE COMPONENT WRITES, and its own
// `<style>` is a body's, reaching its elements and no other. THE REVERT: pass `markScoped` none of
// the file's components in `emitApp` — the `<li>` carries no token, and `.row` matches nothing.
test('an inline component is scoped by its file and by its own style — 32.45, 32.47', async () => {
    const compiled = await compileApp(app)
    const server = compiled.files['index.abide']?.server ?? ''
    const token = /li class=\\"row\\" (a-[\w]+) (a-[\w]+-0)/.exec(server)
    expect(token).not.toBeNull()
    const [, file, own] = token as RegExpExecArray
    const sheet = compiled.files['index.abide']?.sheet
    expect(sheet).toContain(`.row[${file}]`)
    expect(sheet).toContain(`li[${own}]`)
})
