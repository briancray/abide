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
import { List, updateList } from '#ui/List.ts'
import { REGION_CLOSE, REGION_OPEN } from '#ui/REGION.ts'
import { type Row, reconcile } from '#ui/reconcile.ts'
import { Scope } from '#ui/Scope.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'
import { clientOf, closeTyped, refusal } from './typed.ts'

afterAll(closeTyped)

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
    const names = await session.reads(`${ROOT}src/page.abide`, file)
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
    const names = await session.reads(`${ROOT}src/pairs.abide`, file)
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

// A ROW'S BINDINGS ARE ADDRESSED FROM THE ROW'S NODES, and the row's plan is over the region's
// root — whose children are the row's top-level nodes. The row's array IS that root, and reading
// the base as the row ELEMENT instead walks one level too deep.
//
// THE REVERT: make the row's root `__nodes[0]` rather than `__nodes` in `emitList`. The
// single-rooted shape below then walks one step past the text node it was looking for, `textAt`
// puts the run's node INSIDE that text node where nothing can see it, and this reports `0`/`0`
// where `1`/`1` is due with nothing thrown at all. The multi-rooted one reports two
// `abide:hydrate abide: no node at [1,0] ... (41.11)` warnings. Both were green before this,
// because no fixture bound anything below a row's first child.
const NESTED = `<script>
import { reactive } from 'abide'

let rows = reactive(['a', 'b'])
let count = reactive(0)

function bump() {
    count = count + 1
}
</script>

<ul id="deep">{#for row of rows}<li><b>{count}</b></li>{/for}</ul>
<dl id="pair">{#for row of rows}<dt>k</dt><dd>{count}</dd>{/for}</dl>
<button id="bump" onclick={bump}>bump</button>`

test('a binding below a row’s first child is reached, in both row shapes', async () => {
    const file = parseAbide(NESTED)
    const names = await session.reads(`${ROOT}src/nested.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(NESTED, names),
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

    ;(document.querySelector('#bump') as HTMLElement).click()
    flushSync()

    expect(
        [...document.querySelectorAll('#deep b')].map(
            (node) => node.textContent,
        ),
    ).toEqual(['1', '1'])
    expect(
        [...document.querySelectorAll('#pair dd')].map(
            (node) => node.textContent,
        ),
    ).toEqual(['1', '1'])
})

// A ROW THAT LEFT STOPS READING. Its scope is what the reconcile stops, and it is empty unless the
// row's bindings went through it — so this is a WAKE-UP count and not a value: the value on screen
// is right either way.
//
// THE REVERT: open a row's bindings with `watchEffect` rather than through `__scope.watch`. The
// three rows below drop to one and `bindingRuns` reads 3 instead of 1, forever, because the two
// that left still wake on every write and write into nodes no longer in the document.
const LEAVING = `<script>
import { reactive } from 'abide'

let rows = reactive([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
let count = reactive(0)

function drop() {
    rows = [rows[0]]
}

function bump() {
    count = count + 1
}
</script>

<ul id="leaving">{#for row of rows by row.id}<li>{count}</li>{/for}</ul>
<button id="drop" onclick={drop}>drop</button>
<button id="tick" onclick={bump}>tick</button>`

test('a row that left stops reading', async () => {
    const file = parseAbide(LEAVING)
    const names = await session.reads(`${ROOT}src/leaving.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(LEAVING, names),
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

    const three = measure(() => {
        ;(document.querySelector('#tick') as HTMLElement).click()
        flushSync()
    })
    expect(three.bindingRuns).toBe(3)

    ;(document.querySelector('#drop') as HTMLElement).click()
    flushSync()
    expect(document.querySelectorAll('#leaving li').length).toBe(1)

    const one = measure(() => {
        ;(document.querySelector('#tick') as HTMLElement).click()
        flushSync()
    })
    expect(one.bindingRuns).toBe(1)
})

// THE ROW BINDS ITS OWN NAME rather than the emitted markup being rewritten by a regex over the
// item. THE REVERT: `replaceAll(new RegExp('\\b' + item + '\\b', 'g'), '__row')` over the emitted
// expression. The static text below is a JSON string in that expression, so a row the CLIENT makes
// renders `__row profile` where the SERVER wrote `user profile` — and `{#for [a, b] of pairs}`
// throws `Invalid regular expression` out of the compiler itself.
test('the loop variable is a parameter, not a rewrite of emitted text', async () => {
    const client = await clientOf(
        '<script>let rows = reactive([])</script>{#for user of rows}<p>user profile</p>{/for}',
        ['rows'],
    )
    expect(client).toContain('"user profile"')
    expect(client).not.toContain('__row profile')

    expect(
        await refusal(
            clientOf(
                '<script>let rows = reactive([])</script>{#for [a, b] of rows}<p>{a}</p>{/for}',
                ['rows'],
            ),
        ),
    ).toBe('')
})

// A KEY THAT SURVIVES AND A VALUE THAT DOES NOT — the branch every case above is blind to. They
// all PERMUTE the row objects, so `existing.data === data[at]` is true for every key that is still
// there and the remake branch is never reached at all. A REFETCH is the shape that reaches it: the
// same ids come back under new objects, so the key says "already here" and the value says "stale".
//
// THE REVERT: remove a stale row's nodes BEFORE walking the cursor past them, which is what
// `reconcile` did. The cursor is left pointing at a node that is no longer in the document, and
// the `insertBefore` after it throws `DOMException: ... not a child of this node` on the FIRST
// replaced row — 0 of 4 rows rendered where 4 are due, and the list is gone.
const REFETCH = `<script>
import { reactive } from 'abide'

let rows = reactive([
    { id: 'ada', name: 'Ada Lovelace' },
    { id: 'grace', name: 'Grace Hopper' },
    { id: 'katherine', name: 'Katherine Johnson' },
    { id: 'dorothy', name: 'Dorothy Vaughan' },
])

function refetch() {
    rows = rows.map((row) => ({ id: row.id, name: row.name.toUpperCase() }))
}

function replaceMiddle() {
    rows = rows.map((row, at) => at === 1 || at === 2 ? { id: row.id, name: row.name + '!' } : row)
}
</script>

<ul id="refetched">{#for row of rows by row.id}<li data-id={row.id}>{row.name}</li>{/for}</ul>
<button id="refetch" onclick={refetch}>refetch</button>
<button id="middle" onclick={replaceMiddle}>middle</button>`

const refetched = (): string[] =>
    [...document.querySelectorAll('#refetched li')].map(
        (node) => node.textContent ?? '',
    )

async function mountRefetch() {
    const file = parseAbide(REFETCH)
    const names = await session.reads(`${ROOT}src/refetch.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(REFETCH, names),
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
}

test('a refetch that keeps every key and replaces every row remakes them in place', async () => {
    await mountRefetch()
    expect(refetched()).toEqual([
        'Ada Lovelace',
        'Grace Hopper',
        'Katherine Johnson',
        'Dorothy Vaughan',
    ])
    ;(document.querySelector('#refetch') as HTMLElement).click()
    flushSync()

    expect(refetched()).toEqual([
        'ADA LOVELACE',
        'GRACE HOPPER',
        'KATHERINE JOHNSON',
        'DOROTHY VAUGHAN',
    ])
})

// AND THE ROWS AROUND A REPLACED ONE ARE NOT TOUCHED. A whole-list refetch cannot tell a correct
// remake from one that rebuilds the list — every row is new either way — so this replaces two of
// four and asks whether the other two are the same nodes.
test('a row remade between two that survive keeps its neighbours', async () => {
    await mountRefetch()
    const first = document.querySelectorAll('#refetched li')[0] as HTMLElement
    const last = document.querySelectorAll('#refetched li')[3] as HTMLElement

    ;(document.querySelector('#middle') as HTMLElement).click()
    flushSync()

    expect(refetched()).toEqual([
        'Ada Lovelace',
        'Grace Hopper!',
        'Katherine Johnson!',
        'Dorothy Vaughan',
    ])
    expect(document.querySelectorAll('#refetched li')[0]).toBe(first)
    expect(document.querySelectorAll('#refetched li')[3]).toBe(last)
})

// A ROW THAT DID NOT CHANGE IS NOT REMADE, and NaN is the value that made `===` say otherwise:
// `NaN === NaN` is false, so the row never matched itself. This is a WORK assertion and it has to
// be — the text on screen is `NaN` before and after either way, which is why no case above sees it.
//
// THE REVERT: compare with `existing.data === data[at]`. The NaN row's element is then a DIFFERENT
// node after an append that did not touch it — 2 of 3 rows kept where 3 are due — so its focus,
// selection, scroll position and any transition mid-flight go with the node that was replaced.
const NUMBERS = `<script>
import { reactive } from 'abide'

let nums = reactive([1, Number.NaN, 3])

function append() {
    nums = [...nums, 4]
}
</script>

<ul id="nums">{#for n of nums}<li>{n}</li>{/for}</ul>
<button id="append" onclick={append}>append</button>`

test('a row whose value is NaN is not remade', async () => {
    const file = parseAbide(NUMBERS)
    const names = await session.reads(`${ROOT}src/numbers.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(NUMBERS, names),
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

    const before = [...document.querySelectorAll('#nums li')]
    ;(document.querySelector('#append') as HTMLElement).click()
    flushSync()
    const after = [...document.querySelectorAll('#nums li')]

    expect(after.map((node) => node.textContent)).toEqual([
        '1',
        'NaN',
        '3',
        '4',
    ])
    expect(before.map((node, at) => node === after[at])).toEqual([
        true,
        true,
        true,
    ])
})

// 32.16 — `{#for}` OVER AN ASYNC ITERABLE RENDERS EACH ITEM AS IT ARRIVES AND APPENDS RATHER THAN
// RECONCILING, and 41.3 is the server's half: the render is not held for an unfinished stream, so
// the region goes out empty and the client fills it.
//
// THE REVERT, IN TWO PLACES. Drop the `Symbol.asyncIterator` guard in `emitComponent`'s `{#for}`
// and the server render throws `__list is not iterable` — a page that does not render at all where
// an empty region is due. Put `lsN_list` back to a bare `[...__l]` and `mount` throws the same
// TypeError, which `warnMismatch` does not answer, so the whole page's bindings go with it: 0 rows
// where 3 are due, from a page that server-rendered fine.
const ASYNC_PAGE = `<script>
async function* ticks() {
    yield 'first'
    yield 'second'
    yield 'third'
}

const arriving = ticks()
</script>

<ul id="stream">{#for row of arriving}<li>{row}</li>{/for}</ul>`

test('a for over an async iterable appends each item as it arrives', async () => {
    const file = parseAbide(ASYNC_PAGE)
    const names = await session.reads(`${ROOT}src/page.abide`, file)
    const dir = temporaryModule({
        'Async.ts': compileFile(ASYNC_PAGE, names),
        'Async.client.ts': emitClient(file, names),
    })
    const { default: Component } = await import(`${dir}/Async.ts`)
    let html = ''
    for await (const chunk of render(
        Component,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        html += new TextDecoder().decode(chunk)

    // 41.3 — NOTHING INLINE, and the anchors are still there for the client to fill between.
    expect(html).toContain('<ul id="stream"><!--[--><!--]--></ul>')
    expect(html).not.toContain('<li>')

    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Async.client.ts`)
    mount(document.body)

    // The pump is microtasks; one macrotask turn drains every one of them.
    await new Promise((settle) => setTimeout(settle, 0))

    expect(
        [...document.querySelectorAll('#stream li')].map(
            (node) => node.textContent,
        ),
    ).toEqual(['first', 'second', 'third'])
})

// 41.15, 41.16 — A REPEATED `by` KEY. Two tasks sharing a status is the ordinary way to reach one,
// and the map a reconcile holds its rows in cannot hold two under one key. The row it shadowed was
// unreachable from every one of the three places the reconcile cleans up through, so it was never
// stopped and its nodes were never removed: the list grew by one on EVERY reconcile and a watch
// nothing owned kept writing into nodes standing outside it. The screen was right the whole time —
// the extra row renders the value it always did — which is why this is a count and not a value.
//
// THE REVERT: `for (const row of current) held.set(row.key, row)`, with the shadow block and the
// warning taken out. The MOUNT alone reports 4 `<li>` where 3 are due — `first`, `second`,
// `third`, `first` — then 5 after one write and 6 after two, which is the growth stated as a
// count. `bindingRuns` reports 7 where 3 are due and the warning count reports 0 where 1 is.
const REPEATED = `<script>
import { reactive } from 'abide'

let tasks = reactive([
    { id: 'a', status: 'done', label: 'first' },
    { id: 'b', status: 'done', label: 'second' },
    { id: 'c', status: 'open', label: 'third' },
])
let tick = reactive(0)

function touch() {
    tasks = [...tasks]
}

function bump() {
    tick = tick + 1
}
</script>

<ul id="repeated">{#for task of tasks by task.status}<li>{task.label} {tick}</li>{/for}</ul>
<button id="touch" onclick={touch}>touch</button>
<button id="bump" onclick={bump}>bump</button>`

test('a repeated {#for} key keeps the last row, drops what it shadows, and warns once', async () => {
    const file = parseAbide(REPEATED)
    const names = await session.reads(`${ROOT}src/repeated.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(REPEATED, names),
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

    // Only the reconcile's own lines, and only while the clicks below run — `console.warn` is the
    // stand-in for `log.named` everywhere in this seam, so the channel is what tells them apart.
    const said: string[] = []
    const warn = console.warn
    console.warn = (...parts: unknown[]): void => {
        said.push(parts.map(String).join(' '))
    }
    try {
        const { default: mount } = await import(`${dir}/Page.client.ts`)
        mount(document.body)

        const rows = (): string[] =>
            [...document.querySelectorAll('#repeated li')].map(
                (node) => (node.textContent ?? '').split(' ')[0] ?? '',
            )
        expect(rows()).toEqual(['first', 'second', 'third'])

        // One reconcile. The shadowed row is stopped and removed rather than left standing, so the
        // list is the length the subject is — and stays it on the second write.
        ;(document.querySelector('#touch') as HTMLElement).click()
        flushSync()
        expect(rows()).toEqual(['first', 'second', 'third'])
        ;(document.querySelector('#touch') as HTMLElement).click()
        flushSync()
        expect(rows()).toEqual(['first', 'second', 'third'])

        // THE WAKE-UP COUNT, which is the half no output can show: a row nothing stopped wakes on
        // every write for the life of the page and writes into nodes outside the region.
        const woke = measure(() => {
            ;(document.querySelector('#bump') as HTMLElement).click()
            flushSync()
        })
        expect(woke.bindingRuns).toBe(3)

        // 41.16 — ONCE FOR THE BLOCK. The key repeats on every reconcile the region ever runs, and
        // three writes have now gone through it.
        expect(said.filter((line) => line.startsWith('abide:hydrate'))).toEqual(
            [
                'abide:hydrate abide: a {#for} key is repeated in this list, so the last row under it is the one kept and the rows it shadows are dropped. RULEBOOK 41.15.',
            ],
        )
    } finally {
        console.warn = warn
    }
})

// A RE-RUN IS NOT A NEW SOURCE. The subject expression is read inside a watch, so any OTHER
// reactive it touches re-runs it with the SAME iterable — and the append stopped every row,
// removed every node and started a second pump over an async generator already run to completion.
// The list went permanently blank with nothing said about it.
//
// THE REVERT: drop the `list.pumping === source` return in `List.ts`. This reports `['a']` after the re-run where `['a','b']` is due, and `['a']` at the end
// where `['a','b','c']` is.
test('a second call with the same source does not restart the pump', async () => {
    document.body.replaceChildren()
    const host = document.createElement('ul')
    const open = document.createComment(REGION_OPEN)
    const close = document.createComment(REGION_CLOSE)
    host.append(open, close)
    document.body.append(host)
    const region = { open, close }

    let release = (): void => {}
    const held = new Promise<void>((settle) => {
        release = settle
    })
    async function* arriving(): AsyncGenerator<string> {
        yield 'a'
        yield 'b'
        await held
        yield 'c'
    }
    const source = arriving()

    const make = (item: unknown): Node[] => {
        const row = document.createElement('li')
        row.textContent = String(item)
        return [row]
    }
    const mount = (): Scope => new Scope()
    const key = (item: unknown): unknown => item
    const text = (): string[] =>
        [...host.querySelectorAll('li')].map((node) => node.textContent ?? '')

    const list = new List(region, [], key, make, mount)
    updateList(list, source)
    await new Promise((settle) => setTimeout(settle, 0))
    expect(text()).toEqual(['a', 'b'])

    // The watch re-runs over an unrelated write and hands back the same iterable.
    updateList(list, source)
    await new Promise((settle) => setTimeout(settle, 0))
    expect(text()).toEqual(['a', 'b'])

    release()
    await new Promise((settle) => setTimeout(settle, 0))
    expect(text()).toEqual(['a', 'b', 'c'])
})

// THE CASE THE FOUR-ROW SWAP ABOVE IS BLIND TO, and the reason it needs 200 rows: WHICH two rows
// swap decides whether the old forward walk was optimal or catastrophic, and at n=4 every swap is
// adjacent. A cursor that only advances when a row is already in place gets stuck on the first
// row it moved past, so every row between the two ends is dragged in front of it.
//
// THE REVERT, run: the forward walk this replaced. The ORDER is identical, every other test in
// this file passes, and the counts go 2 -> 197 on the distant swap and 1 -> 1 on the adjacent one
// — so a gate written only at n=4 could never have failed. It cost more wall clock in chromium to
// swap two rows (30.4 µs) than to reverse the whole list (29.2 µs).
const REORDERS = 200

function seeded(): {
    region: { open: Comment; close: Comment }
    rows: Row[]
    data: { id: number }[]
} {
    const data: { id: number }[] = []
    for (let at = 0; at < REORDERS; at += 1) data.push({ id: at })
    document.body.innerHTML = '<ul id="wide"></ul>'
    const list = document.getElementById('wide') as HTMLElement
    const open = document.createComment(REGION_OPEN)
    const close = document.createComment(REGION_CLOSE)
    list.append(open)
    const rows: Row[] = []
    for (let at = 0; at < REORDERS; at += 1) {
        const item = document.createElement('li')
        item.setAttribute('data-id', String(at))
        list.append(item)
        rows.push({
            key: at,
            data: data[at] as object,
            nodes: [item],
            scope: new Scope(),
            at,
        })
    }
    list.append(close)
    return { region: { open, close }, rows, data }
}

function reorder(permute: (order: number[]) => number[]): {
    moved: number
    order: string[]
} {
    const { region, rows, data } = seeded()
    const order: number[] = []
    for (let at = 0; at < REORDERS; at += 1) order.push(at)
    const wantedOrder = permute(order)
    const wanted = wantedOrder.map((at) => data[at] as object)
    const list = new List(
        region as never,
        rows,
        (item) => (item as { id: number }).id,
        () => [document.createElement('li')],
        () => new Scope(),
    )
    const work = measure(() => {
        reconcile(list, wanted)
    })
    return {
        moved: work.elementsMoved ?? -1,
        order: [...document.querySelectorAll('#wide li')].map(
            (node) => (node as HTMLElement).getAttribute('data-id') ?? '',
        ),
    }
}

test('swapping two DISTANT rows moves two nodes, not the rows between them', () => {
    const wanted: string[] = []
    for (let at = 0; at < REORDERS; at += 1) wanted.push(String(at))
    wanted[1] = String(REORDERS - 2)
    wanted[REORDERS - 2] = '1'

    const result = reorder((order) => {
        const copy = [...order]
        copy[1] = REORDERS - 2
        copy[REORDERS - 2] = 1
        return copy
    })
    // The whole result, not its edges: a guard that BRACKETS its changes is right at both ends
    // and wrong between, which is exactly what this case is for.
    expect(result.order).toEqual(wanted)
    expect(`moved: ${result.moved}`).toBe('moved: 2')
})

test('a full reverse of 200 rows still transposes correctly', () => {
    const wanted: string[] = []
    for (let at = REORDERS - 1; at >= 0; at -= 1) wanted.push(String(at))
    const result = reorder((order) => [...order].reverse())
    expect(result.order).toEqual(wanted)
    // Every row genuinely moves, so this prices nothing — it is here because it is what catches a
    // transposition the two-row cases report clean.
    expect(`moved: ${result.moved}`).toBe(`moved: ${REORDERS - 1}`)
})

// A SUBJECT THAT WAS ASYNC AND IS NOW A LIST stops the pump. The reconcile re-keys nothing, so a
// pump left running kept inserting before the closing anchor after the reconciled list — rows
// nothing would ever remove or stop.
//
// THE REVERT: drop `list.pumping = null` from `updateList`. This reports `['x', 'c']` where
// `['x']` is due.
test('a list arriving in place of a stream stops the stream', async () => {
    document.body.replaceChildren()
    const host = document.createElement('ul')
    const open = document.createComment(REGION_OPEN)
    const close = document.createComment(REGION_CLOSE)
    host.append(open, close)
    document.body.append(host)

    let release = (): void => {}
    const held = new Promise<void>((settle) => {
        release = settle
    })
    async function* arriving(): AsyncGenerator<string> {
        yield 'a'
        await held
        yield 'c'
    }
    const make = (item: unknown): Node[] => {
        const row = document.createElement('li')
        row.textContent = String(item)
        return [row]
    }
    const list = new List(
        { open, close },
        [],
        (item) => item,
        make,
        () => new Scope(),
    )
    const text = (): string[] =>
        [...host.querySelectorAll('li')].map((node) => node.textContent ?? '')

    updateList(list, arriving())
    await new Promise((settle) => setTimeout(settle, 0))
    expect(text()).toEqual(['a'])

    updateList(list, ['x'])
    release()
    await new Promise((settle) => setTimeout(settle, 0))
    expect(text()).toEqual(['x'])
})

// THE SUBJECT IS READ ONCE ON LOAD, and the rows are hydrated against that one read. Read twice —
// once to hydrate and again on the watch's first run — a subject building FRESH items matched no
// row by identity, so every row the server sent was dropped and remade before anyone touched the
// page. THE REVERT: hydrate from a `seed` read ahead of the watch rather than on its first run;
// this reports 0 of 3 server rows kept where 3 are due.
const FRESH = `<script>
import { reactive } from 'abide'

let rows = reactive([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
</script>

<ul id="fresh">{#for row of rows.map((r) => ({ ...r })) by row.id}<li>{row.id}</li>{/for}</ul>`

test('a subject building fresh items keeps the rows the server sent', async () => {
    const file = parseAbide(FRESH)
    const names = await session.reads(`${ROOT}src/fresh.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(FRESH, names),
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
    const sent = [...document.querySelectorAll('#fresh li')]
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    mount(document.body)
    const kept = [...document.querySelectorAll('#fresh li')].filter(
        (node, at) => node === sent[at],
    )
    expect(sent).toHaveLength(3)
    expect(kept).toHaveLength(3)
})

// 41.11 THROUGH THE COUNTS, which is the only truth hydration has. A hydrating run wires row `at`
// to item `at` BY POSITION, so a document holding fewer rows than the client computes items has
// items with no node — and `updateList` used to RETURN on the hydrate, so reconcile never ran and
// the missing rows never arrived. The list looked right and was dead: the `{#for}` kept whatever
// the server happened to send for the life of the page.
//
// 41.4 IS THE ZERO CASE OF THIS and is what found it — a subject still in flight paints no rows at
// all — but zero is not the shape to gate on, because a guard written for it (`found.length === 0`)
// is right at one end and wrong everywhere else. Three-of-five is the case that tells a count
// check from a zero check, the way CLAUDE.md's two-row swap tells a reconcile from a rebuild.
//
// THE REVERT: return `true` from `hydrate` whenever `found.length === 0` is false — this reports
// 3 rows where 5 are due, with no warning and no throw.
const FIVE = `<script>
import { reactive } from 'abide'

let rows = reactive([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }])
</script>

<ul id="five">{#for row of rows by row.id}<li>{row.id}</li>{/for}</ul>`

test('a document holding fewer rows than the client computes reconciles — 41.11', async () => {
    const file = parseAbide(FIVE)
    const names = await session.reads(`${ROOT}src/five.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(FIVE, names),
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
    // THE DIVERGENCE, made by hand because no shape in this suite produces one: the document is
    // short two rows, exactly as a server that rendered against a smaller list would leave it.
    const painted = [...document.querySelectorAll('#five li')]
    expect(painted).toHaveLength(5)
    for (const node of painted.slice(3)) node.remove()
    expect(document.querySelectorAll('#five li')).toHaveLength(3)

    const { default: mount } = await import(`${dir}/Page.client.ts`)
    const said: string[] = []
    const warn = console.warn
    console.warn = (...parts: unknown[]): void => {
        said.push(parts.map(String).join(' '))
    }
    try {
        mount(document.body)
    } finally {
        console.warn = warn
    }
    expect(
        [...document.querySelectorAll('#five li')].map((n) => n.textContent),
    ).toEqual(['a', 'b', 'c', 'd', 'e'])
    // AND IT SAID SO. Repairing the divergence in silence is 41.11 half applied \u2014 the rows come
    // back either way, so the warning is the only thing that reports a document and a client that
    // disagree. THE REVERT: return `false` from `hydrate` without warning; the rows still arrive
    // and this reports [].
    expect(said.filter((line) => line.includes('41.11'))).toHaveLength(1)
    expect(said.join(' ')).toContain('holds 3 rows')
})
