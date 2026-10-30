// 32.26 IN A SLOT THAT MOVES. A slot renders a value `raw` branded as markup, and the server has
// always done so — but a LIVE run on the client was a text node written through `data`, so the
// first time the value changed its markup went on the screen as text, and a server-painted raw
// value was not a text node at all where the walk expected one.
//
// A RUN THAT CAN HOLD MARKUP is written as TEXT while its value is text and as an ANCHORED RUN —
// `<!--{-->…<!--}-->` — while any part of it is `Raw`, on both sides. The anchors are written only
// for a value that is `Raw` at that moment, so an ordinary run carries nothing and costs nothing
// in the document.

import { afterAll, expect, test } from 'bun:test'

import { measure } from '@abide/harness/abide'

import { flushSync } from '#shared'

import { removeTemporaryModules } from './temporaryModule.ts'
import { closeTyped, renderPage } from './typed.ts'

afterAll(closeTyped)
afterAll(removeTemporaryModules)

// A mount run under the counters, and what `console.warn` was told while it ran: 41.10's warning is
// the only trace a rebuilt region leaves.
function countedMount(mount: () => unknown): { said: string[]; work: Work } {
    let work: Work | undefined
    const said = warningsWhile(() => {
        work = measure(mount)
    })
    return { said, work: work as Work }
}

async function mountCounted(
    source: string,
): Promise<{ html: string; said: string[]; work: Work }> {
    const { html, mount } = await renderPage(source)
    return { html, ...countedMount(mount) }
}

type Work = ReturnType<typeof measure>

function warningsWhile(body: () => void): string[] {
    const said: string[] = []
    const warn = console.warn
    console.warn = (...parts: unknown[]): void => {
        said.push(parts.map(String).join(' '))
    }
    try {
        body()
    } finally {
        console.warn = warn
    }
    return said
}

const click = (id: string): void => {
    ;(document.querySelector(id) as HTMLElement).click()
    flushSync()
}

// An element's children as one line — a comment by its data, a text node quoted, an element by
// its tag and its text — so "the markup went in as elements" and "it went in as text" read apart.
function shapeOf(parent: Element): string {
    const parts: string[] = []
    for (const node of parent.childNodes)
        parts.push(
            node.nodeType === 8
                ? `<!--${(node as Comment).data}-->`
                : node.nodeType === 3
                  ? JSON.stringify((node as Text).data)
                  : `${node.nodeName.toLowerCase()}(${node.textContent})`,
        )
    return parts.join(',')
}

const out = (): Element => document.querySelector('#out') as Element

// A LIVE `{raw(html)}` THAT UPDATES. The server paints the first value as elements; the client
// hydrates the run it painted and writes the next value AS MARKUP, and a live sibling after the
// run in the same parent is still where the walk expects it.
//
// THE REVERTS: have `emitClient`'s live run write `setText` whatever the value holds (the pre-fix
// emitter), and the hydrated run reads `"<b>one</b>",span(0)` — the painted markup rewritten as
// text on the binding's first run. Have `runHere` answer a run's first node as found, and seven
// of the eight tests here are refused with 41.10's "text was due" warning. Have `markupRun` never anchor,
// and seven of the eight fail.
test('a live {raw(html)} writes its next value as markup', async () => {
    const { html, said } = await mountCounted(`<script>
import { reactive } from '@abide/abide'

let html = reactive('<b>one</b>')
let count = reactive(0)
</script>

<p id="out">{raw(html)}<span>{count}</span></p>
<button id="next" onclick={() => { html = '<i>two</i>'; count = count + 1 }}>next</button>`)

    expect(html).toContain(
        '<p id="out"><!--{--><b>one</b><!--}--><span>0</span></p>',
    )
    expect(said).toEqual([])
    expect(shapeOf(out())).toBe('<!--{-->,b(one),<!--}-->,span(0)')

    click('#next')
    expect(shapeOf(out())).toBe('<!--{-->,i(two),<!--}-->,span(1)')
})

// THE SAME RUN WITH TEXT ON BOTH SIDES OF IT — one run to the parser, and one to the anchors.
test('a live raw value inside a run of text is the whole run, anchored', async () => {
    const { said } = await mountCounted(`<script>
import { reactive } from '@abide/abide'

let html = reactive('<b>one</b>')
</script>

<p id="out">before {raw(html)} after</p>
<button id="next" onclick={() => { html = '<i>two</i>' }}>next</button>`)

    expect(said).toEqual([])
    expect(shapeOf(out())).toBe('<!--{-->,"before ",b(one)," after",<!--}-->')
    click('#next')
    expect(shapeOf(out())).toBe('<!--{-->,"before ",i(two)," after",<!--}-->')
})

// `{x}` WHERE `x` HOLDS A STRING ONE MOMENT AND A `Raw` THE NEXT — 32.26 is a slot's clause, not
// the `raw(` spelling's. Both ways round, from a first value of either kind, and a string after a
// raw value is TEXT again: its `<` escaped, no element made of it.
//
// THE REVERT: the pre-fix `setText` emitter. Both report `"<b>bold</b>"` as text where the
// anchored `b(bold)` is due — from a string first on the switch, from a `Raw` first at hydration.
const SWITCHING = (first: string): string => `<script>
import { reactive, raw, type Raw } from '@abide/abide'

let value = reactive<string | Raw>(${first})
</script>

<p id="out">{value}</p>
<button id="markup" onclick={() => { value = raw('<b>bold</b>') }}>markup</button>
<button id="text" onclick={() => { value = '<i>plain</i>' }}>text</button>`

test('a slot holding a string and then a raw value renders each as itself', async () => {
    const { html, said } = await mountCounted(SWITCHING("'<i>plain</i>'"))
    expect(html).toContain('<p id="out">&lt;i&gt;plain&lt;/i&gt;</p>')
    expect(said).toEqual([])
    expect(shapeOf(out())).toBe('"<i>plain</i>"')

    click('#markup')
    expect(shapeOf(out())).toBe('<!--{-->,b(bold),<!--}-->')
    click('#text')
    expect(shapeOf(out())).toBe('"<i>plain</i>"')
    click('#markup')
    expect(shapeOf(out())).toBe('<!--{-->,b(bold),<!--}-->')
})

test('a slot holding a raw value and then a string renders each as itself', async () => {
    const { html, said } = await mountCounted(SWITCHING("raw('<b>bold</b>')"))
    expect(html).toContain('<p id="out"><!--{--><b>bold</b><!--}--></p>')
    expect(said).toEqual([])
    expect(shapeOf(out())).toBe('<!--{-->,b(bold),<!--}-->')

    click('#text')
    expect(shapeOf(out())).toBe('"<i>plain</i>"')
    click('#markup')
    expect(shapeOf(out())).toBe('<!--{-->,b(bold),<!--}-->')
})

// HYDRATION ADOPTS WHAT THE SERVER PAINTED. The painted element is the node the page keeps — no
// node is created at mount and none is replaced — and the region after the run, found from the
// run's closing anchor, hydrates without a warning.
//
// THE REVERT: drop the anchor step from the walk (`runHere` answering its node as found). The
// run and the `{#if}` after it are both looked for at the run's opening anchor, and this reports
// 41.10's "text was due" AND "a region was due" warnings.
test('hydration keeps the markup a raw slot was painted with', async () => {
    const { said } = await mountCounted(`<script>
import { reactive } from '@abide/abide'

let html = reactive('<b>one</b><em>two</em>')
let on = reactive(true)
</script>

<p id="out">{raw(html)}{#if on}<span>{on}</span>{/if}</p>
<button id="flip" onclick={() => { on = !on }}>flip</button>`)
    expect(said).toEqual([])
    expect(shapeOf(out())).toBe(
        '<!--{-->,b(one),em(two),<!--}-->,<!--[0-->,span(true),<!--]-->',
    )
    const painted = out().querySelector('b')
    click('#flip')
    expect(shapeOf(out())).toBe(
        '<!--{-->,b(one),em(two),<!--}-->,<!--[0-->,<!--]-->',
    )
    click('#flip')
    expect(out().querySelector('b') === painted).toBe(true)
    expect(shapeOf(out())).toBe(
        '<!--{-->,b(one),em(two),<!--}-->,<!--[0-->,span(true),<!--]-->',
    )
})

test('hydrating a painted raw slot creates no node', async () => {
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let html = reactive('<b>one</b>')
</script>

<p id="out">{raw(html)}</p>`)
    const painted = document.querySelector('#out b')
    const { said, work } = countedMount(mount)
    expect(said).toEqual([])
    // THE REVERT: have `setMarkup` rewrite a run it adopted rather than keep it. The markup is
    // the same and this reports `nodesCreated` 0 -> 2 and a different `<b>`.
    expect(work.nodesCreated).toBe(0)
    expect(document.querySelector('#out b') === painted).toBe(true)
})

// A RAW SLOT IN A ROW — one the server painted, one the browser grows, and both rewritten when the
// value they read moves. A row's markup is BUILT rather than parsed in the browser, so the grown
// row is the build's run and the painted one the parser's, and they have to read the same.
//
// THE REVERT: the pre-fix `setText` emitter. Every row, painted or grown, reports its markup as
// text: `"<b>a</b>"` where `b(a)` is due.
test('a raw slot in a {#for} row renders as markup, painted and grown', async () => {
    const { said } = await mountCounted(`<script>
import { reactive } from '@abide/abide'

let tag = reactive('b')
let rows = reactive([{ id: 'a' }])
</script>

<ul id="out">{#for row of rows by row.id}<li>{raw('<' + tag + '>' + row.id + '</' + tag + '>')}</li>{/for}</ul>
<button id="add" onclick={() => { rows = [...rows, { id: 'z' }] }}>add</button>
<button id="tag" onclick={() => { tag = 'i' }}>tag</button>
<button id="reverse" onclick={() => { rows = [...rows].reverse() }}>reverse</button>`)
    expect(said).toEqual([])
    const items = (): string[] =>
        [...out().querySelectorAll('li')].map((li) => shapeOf(li))
    expect(items()).toEqual(['<!--{-->,b(a),<!--}-->'])

    click('#add')
    expect(items()).toEqual([
        '<!--{-->,b(a),<!--}-->',
        '<!--{-->,b(z),<!--}-->',
    ])
    click('#tag')
    expect(items()).toEqual([
        '<!--{-->,i(a),<!--}-->',
        '<!--{-->,i(z),<!--}-->',
    ])
    click('#reverse')
    expect(items()).toEqual([
        '<!--{-->,i(z),<!--}-->',
        '<!--{-->,i(a),<!--}-->',
    ])
})

// AND AT A ROW'S TOP LEVEL, where the row is its anchor and its siblings: the anchored run moves
// with the row it stands in, and a sibling after it in the row is still found.
test('a raw slot at the top of a row moves with its row', async () => {
    const { said } = await mountCounted(`<script>
import { reactive } from '@abide/abide'

let tag = reactive('b')
let rows = reactive([{ id: 'a' }, { id: 'c' }])
</script>

<div id="out">{#for row of rows by row.id}{raw('<' + tag + '>' + row.id + '</' + tag + '>')}<span>{row.id}{tag}</span>{/for}</div>
<button id="tag" onclick={() => { tag = 'i' }}>tag</button>
<button id="reverse" onclick={() => { rows = [...rows].reverse() }}>reverse</button>`)
    expect(said).toEqual([])
    expect(shapeOf(out())).toBe(
        '<!--[-->,<!--r-->,<!--{-->,b(a),<!--}-->,span(ab),<!--r-->,<!--{-->,b(c),<!--}-->,span(cb),<!--]-->',
    )
    click('#reverse')
    click('#tag')
    expect(shapeOf(out())).toBe(
        '<!--[-->,<!--r-->,<!--{-->,i(c),<!--}-->,span(ci),<!--r-->,<!--{-->,i(a),<!--}-->,span(ai),<!--]-->',
    )
})
