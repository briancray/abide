// `{#for}` — 32.14, and the first place `nodesMoved` means anything.
//
// TWO CASES, AND THEY ARE DIFFERENT CASES. A two-row swap tells a minimal keyed reconcile from a
// rebuild: both put the right text on screen and only the counts differ. A full REVERSE cannot
// price anything — every row moves either way — but it is what catches a transposition that
// corrupts the middle, which the swap is blind to. CLAUDE.md asks for both and they are both here.

import { afterAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { compileFile, emitClient, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync } from '#shared'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)
afterAll(() => {
    session.close()
    removeTemporaryModules()
})

const PAGE = `<script>
import { reactive } from 'abide'

let rows = reactive([
    { id: 'ada', name: 'Ada Lovelace' },
    { id: 'grace', name: 'Grace Hopper' },
    { id: 'katherine', name: 'Katherine Johnson' },
    { id: 'dorothy', name: 'Dorothy Vaughan' },
])

function swapTop() {
    const [first, second, ...rest] = rows
    rows = [second, first, ...rest]
}

function reverse() {
    rows = [...rows].reverse()
}
</script>

<ul id="list">{#for row of rows by row.id}<li data-id={row.id}>{row.name}</li>{/for}</ul>
<button id="swap" onclick={swapTop}>swap</button>
<button id="reverse" onclick={reverse}>reverse</button>`

async function mountPage() {
    const file = parseAbide(PAGE)
    const names = await session.reactiveNames(`${ROOT}src/page.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(PAGE, names),
        'Page.client.ts': emitClient(file, names),
    })
    const { default: Component } = await import(`${dir}/Page.ts`)
    let html = ''
    for await (const chunk of render(
        Component,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        html += new TextDecoder().decode(chunk)
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    mount(document.body)
    return html
}

const order = (): string[] =>
    [...document.querySelectorAll('#list li')].map(
        (node) => (node as HTMLElement).getAttribute('data-id') ?? '',
    )

test('the server renders every row, and the list carries no per-row marker', async () => {
    const html = await mountPage()
    expect(order()).toEqual(['ada', 'grace', 'katherine', 'dorothy'])
    // Two anchors for the region, and nothing per row: a row IS its element, so there is nothing
    // to add to tell rows apart.
    expect((html.match(/<!--/g) ?? []).length).toBe(2)
    expect(html).not.toContain('data-a')
})

// THE COST CASE. A swap of two rows moves ONE node in a minimal keyed reconcile — the second row
// is put before the first and everything else is already where it belongs.
//
// THE REVERT: append every surviving row in order before the closing anchor
// (`parent.insertBefore(existing.node, region.close)`). The resulting ORDER is identical and
// every other test in this file still passes; this one reports 4 elements moved where 1 is due.
// Dropping the cursor check instead is NOT the revert — it breaks the order and fails all four,
// which measures nothing about the mechanism.
test('a two-row swap moves one node', async () => {
    await mountPage()
    const before = document.querySelectorAll('#list li')[2] as HTMLElement

    const work = measure(() => {
        ;(document.querySelector('#swap') as HTMLElement).click()
        flushSync()
    })

    expect(order()).toEqual(['grace', 'ada', 'katherine', 'dorothy'])
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(1)
    // The rows that did not move are the SAME nodes, which is what a rebuild cannot say.
    expect(document.querySelectorAll('#list li')[2]).toBe(before)
})

// THE CORRECTNESS CASE. A full reverse prices nothing — every row moves either way — and it is
// the one that catches a reconcile that transposes correctly at the ends and corrupts the middle,
// which the swap above is blind to.
test('a full reverse puts every row in the right place', async () => {
    await mountPage()
    const nodes = new Map(
        [...document.querySelectorAll('#list li')].map((node) => [
            (node as HTMLElement).getAttribute('data-id'),
            node,
        ]),
    )

    ;(document.querySelector('#reverse') as HTMLElement).click()
    flushSync()

    expect(order()).toEqual(['dorothy', 'katherine', 'grace', 'ada'])
    // Every row is the node it was. A reconcile that rebuilt would pass the order check above and
    // fail this one.
    for (const [id, node] of nodes)
        expect(document.querySelector(`#list li[data-id="${id}"]`)).toBe(node)
})

test('the rows survive a swap with their bindings', async () => {
    await mountPage()
    ;(document.querySelector('#swap') as HTMLElement).click()
    flushSync()
    ;(document.querySelector('#reverse') as HTMLElement).click()
    flushSync()
    expect(order()).toEqual(['dorothy', 'katherine', 'ada', 'grace'])
    expect(
        (document.querySelector('#list li') as HTMLElement).textContent,
    ).toBe('Dorothy Vaughan')
})

// A BODY WITH SEVERAL TOP-LEVEL NODES. `<dl><dt>..</dt><dd>..</dd></dl>` is ordinary HTML and the
// row has no single node that IS it — counting elements between the region's anchors finds four
// rows in a list of two, which is how this was found: the server rendered correctly and the
// client threw `undefined is not an object (evaluating '__row.id')` at mount.
//
// It gets ONE anchor per ROW, which is ~2.5 bytes gzipped a row — not the per-SLOT marker
// `benchGrid.ts` measured doubling a page. A single-element row still carries nothing.
const PAIRS = `<script>
import { reactive } from 'abide'

let rows = reactive([
    { id: 'a', k: 'Ada', v: '1815' },
    { id: 'b', k: 'Grace', v: '1906' },
    { id: 'c', k: 'Katherine', v: '1918' },
])

function reverse() {
    rows = [...rows].reverse()
}
</script>

<dl id="pairs">{#for row of rows by row.id}<dt>{row.k}</dt><dd>{row.v}</dd>{/for}</dl>
<button id="rev" onclick={reverse}>reverse</button>`

async function mountPairs() {
    const file = parseAbide(PAIRS)
    const names = await session.reactiveNames(`${ROOT}src/pairs.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(PAIRS, names),
        'Page.client.ts': emitClient(file, names),
    })
    const { default: Component } = await import(`${dir}/Page.ts`)
    let html = ''
    for await (const chunk of render(
        Component,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        html += new TextDecoder().decode(chunk)
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    mount(document.body)
    return html
}

const pairText = (): string[] =>
    [...document.querySelectorAll('#pairs > *')].map(
        (node) => node.textContent ?? '',
    )

test('a row with several top-level nodes mounts and reorders whole', async () => {
    const html = await mountPairs()
    // One anchor a row, plus the region's two. A single-element row would have only the two.
    expect((html.match(/<!--r-->/g) ?? []).length).toBe(3)
    expect(pairText()).toEqual([
        'Ada',
        '1815',
        'Grace',
        '1906',
        'Katherine',
        '1918',
    ])

    const first = document.querySelector('#pairs dt') as HTMLElement
    ;(document.querySelector('#rev') as HTMLElement).click()
    flushSync()

    // BOTH nodes of each row moved, and together: a `<dd>` left behind its `<dt>` is the failure
    // this shape has that a single-element row cannot.
    expect(pairText()).toEqual([
        'Katherine',
        '1918',
        'Grace',
        '1906',
        'Ada',
        '1815',
    ])
    // And they are the same nodes — reordered, not rebuilt.
    expect(document.querySelectorAll('#pairs dt')[2]).toBe(first)
})

// THE REVERT: emit no row anchor and count elements instead (`isSingleRooted` returning true
// always). `rowsIn` then finds 6 rows in a list of 3, and the mount throws
// `undefined is not an object` on the fourth — which is what this did before it was built.
test('a single-element row still carries no anchor', async () => {
    const html = await mountPage()
    expect(html).not.toContain('<!--r-->')
    expect((html.match(/<!--/g) ?? []).length).toBe(2)
})
