// `{#for}` — 32.13, and the first place `nodesMoved` means anything.
//
// TWO CASES, AND THEY ARE DIFFERENT CASES. A two-row swap tells a minimal keyed reconcile from a
// rebuild: both put the right text on screen and only the counts differ. A full REVERSE cannot
// price anything — every row moves either way — but it is what catches a transposition that
// corrupts the middle, which the swap is blind to. CLAUDE.md asks for both and they are both here.

import { afterAll, expect, test } from 'bun:test'
import { AsyncLocalStorage } from 'node:async_hooks' // bun implements AsyncLocalStorage and has no context-carrying api of its own
import { measure } from 'harness/measure'
import { flushSync, reactive } from '#shared'
import { REGION_CLOSE, REGION_OPEN } from '#shared/ANCHORS.ts'
import { List, listAt, updateList } from '#ui/List.ts'
import { EMPTY_SCOPE, Scope } from '#ui/Scope.ts'
import { removeTemporaryModules } from './temporaryModule.ts'
import {
    clientOf,
    closeTyped,
    mountPage,
    refusal,
    renderPage,
} from './typed.ts'

afterAll(closeTyped)

afterAll(removeTemporaryModules)

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

const order = (): string[] =>
    [...document.querySelectorAll('#list li')].map(
        (node) => (node as HTMLElement).getAttribute('data-id') ?? '',
    )

test('the server renders every row, and the list carries no per-row marker', async () => {
    const { html } = await mountPage(PAGE)
    expect(order()).toEqual(['ada', 'grace', 'katherine', 'dorothy'])
    // Two anchors for the region and two for the page (41.9), and nothing per row: a row IS its
    // element, so there is nothing to add to tell rows apart.
    expect((html.match(/<!--/g) ?? []).length).toBe(4)
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
    await mountPage(PAGE)
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
    await mountPage(PAGE)
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
    await mountPage(PAGE)
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

const pairText = (): string[] =>
    [...document.querySelectorAll('#pairs > *')].map(
        (node) => node.textContent ?? '',
    )

test('a row with several top-level nodes mounts and reorders whole', async () => {
    const { html } = await mountPage(PAIRS)
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
    const { html } = await mountPage(PAGE)
    expect(html).not.toContain('<!--r-->')
    // The list's pair and the page's.
    expect((html.match(/<!--/g) ?? []).length).toBe(4)
})

// A ROW'S BINDINGS ARE FOUND FROM THE ROW'S NODES — the array the reconcile hands back, whose
// entries are the row's top-level nodes. Starting the walk INSIDE the row element instead walks
// one level too deep.
//
// THE REVERT: start a row's walk at `__row.node?.firstChild` (and a multi-rooted one a node late)
// in `emitComponent`'s `{#for}` arm. Every binding below the row's first child then lands a level
// off, and this reports the wrong counts with NOTHING warned — no kind check fires, because what
// the walk lands on is still the kind it expected. Green before, because no fixture bound
// anything below a row's first child.
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
    const { mount } = await renderPage(NESTED)
    mount()

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
    const { mount } = await renderPage(LEAVING)
    mount()

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

test('a refetch that keeps every key and replaces every row remakes them in place', async () => {
    await mountPage(REFETCH)
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
    await mountPage(REFETCH)
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
    const { mount } = await renderPage(NUMBERS)
    mount()

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

// 32.15 — `{#for}` OVER AN ASYNC ITERABLE RENDERS EACH ITEM AS IT ARRIVES AND APPENDS RATHER THAN
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
    const { html, mount } = await renderPage(ASYNC_PAGE)

    // 41.3 — NOTHING INLINE, and the anchors are still there for the client to fill between.
    expect(html).toContain('<ul id="stream"><!--[--><!--]--></ul>')
    expect(html).not.toContain('<li>')

    mount()

    // The pump is microtasks; one macrotask turn drains every one of them.
    await new Promise((settle) => setTimeout(settle, 0))

    expect(
        [...document.querySelectorAll('#stream li')].map(
            (node) => node.textContent,
        ),
    ).toEqual(['first', 'second', 'third'])
})

// 41.14, 41.15 — A REPEATED `by` KEY. Two tasks sharing a status is the ordinary way to reach one,
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
    const { mount } = await renderPage(REPEATED)

    // Only the reconcile's own lines, and only while the clicks below run — `console.warn` is the
    // stand-in for `log.named` everywhere in this seam, so the channel is what tells them apart.
    const said: string[] = []
    const warn = console.warn
    console.warn = (...parts: unknown[]): void => {
        said.push(parts.map(String).join(' '))
    }
    try {
        mount()

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

        // 41.15 — ONCE FOR THE BLOCK. The key repeats on every reconcile the region ever runs, and
        // three writes have now gone through it.
        const hydrate = said.filter((line) => line.includes('abide:hydrate'))
        expect(hydrate).toHaveLength(1)
        expect(hydrate[0]).toContain(
            'abide: a {#for} key is repeated in this list, so the last row under it is the one kept and the rows it shadows are dropped. RULEBOOK 41.14.',
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

    const make = (made: Document, item: unknown): Node[] => {
        const row = made.createElement('li')
        row.textContent = String(item)
        return [row]
    }
    const mount = (): Scope => new Scope()
    const key = (item: unknown): unknown => item
    const text = (): string[] =>
        [...host.querySelectorAll('li')].map((node) => node.textContent ?? '')

    const builders = { make, mount }
    const list = listAt(region, false, key, () => builders)
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

// SEEDED AS A SERVED PAGE'S LIST IS: the rows are painted markup, and the first update hydrates
// them, so the reorder below is the second update — the reconcile — and nothing hand-builds a row.
function seeded(): {
    region: { open: Comment; close: Comment }
    data: { id: number }[]
} {
    const data: { id: number }[] = []
    for (let at = 0; at < REORDERS; at += 1) data.push({ id: at })
    document.body.innerHTML = '<ul id="wide"></ul>'
    const list = document.getElementById('wide') as HTMLElement
    const open = document.createComment(REGION_OPEN)
    const close = document.createComment(REGION_CLOSE)
    list.append(open)
    for (let at = 0; at < REORDERS; at += 1) {
        const item = document.createElement('li')
        item.setAttribute('data-id', String(at))
        list.append(item)
    }
    list.append(close)
    return { region: { open, close }, data }
}

function reorder(permute: (order: number[]) => number[]): {
    moved: number
    order: string[]
} {
    const { region, data } = seeded()
    const order: number[] = []
    for (let at = 0; at < REORDERS; at += 1) order.push(at)
    const wantedOrder = permute(order)
    const wanted = wantedOrder.map((at) => data[at] as object)
    const list = listAt(
        region,
        false,
        (item) => (item as { id: number }).id,
        () => ({
            make: () => [document.createElement('li')],
            mount: () => new Scope(),
        }),
    )
    updateList(list, data)
    const work = measure(() => {
        updateList(list, wanted)
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
    const make = (made: Document, item: unknown): Node[] => {
        const row = made.createElement('li')
        row.textContent = String(item)
        return [row]
    }
    const list = listAt(
        { open, close },
        false,
        (item) => item,
        () => ({ make, mount: () => new Scope() }),
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

// 12.13 — A STOPPED LIST LETS GO OF ITS SOURCE NOW, not at the source's next item. A feed that has
// gone quiet produces none, and the cursor the pump was parked on held its subscription — and the
// list and its region — for as long as the feed stayed silent. THE REVERT: drop the
// `iterator.return` from `stopPump`; `returned` reads false where true is due.
test('a list stopped while its source is quiet returns the source at once — 12.13', async () => {
    document.body.replaceChildren()
    const host = document.createElement('ul')
    const open = document.createComment(REGION_OPEN)
    const close = document.createComment(REGION_CLOSE)
    host.append(open, close)
    document.body.append(host)

    let returned = false
    let handed = false
    // One item, then silence: the next `next()` never settles.
    const quiet: AsyncIterable<string> = {
        [Symbol.asyncIterator]: () => ({
            next: () => {
                if (handed) return new Promise<IteratorResult<string>>(() => {})
                handed = true
                return Promise.resolve({ value: 'a', done: false })
            },
            return: () => {
                returned = true
                return Promise.resolve({ value: undefined, done: true })
            },
        }),
    }
    const make = (made: Document, item: unknown): Node[] => {
        const row = made.createElement('li')
        row.textContent = String(item)
        return [row]
    }
    const list = listAt(
        { open, close },
        false,
        (item) => item,
        () => ({ make, mount: () => new Scope() }),
    )
    updateList(list, quiet)
    await new Promise((settle) => setTimeout(settle, 0))
    expect(host.querySelectorAll('li')).toHaveLength(1)

    list.stop()
    expect(returned).toBe(true)
})

// A ROW'S BUILD IS NOT THE LIST'S READ. `make` evaluates a row's attributes as it builds them, and
// under the list's watch that subscribed the whole list to whatever a row read — a `class:danger`
// on `selected` cost a full reconcile on the next `selected` write. THE REVERT: call `settleList`
// tracked from `updateList`; this reports 1 list run where 0 are due.
test('a value a row read while it was built does not re-run the list', () => {
    document.body.replaceChildren()
    const host = document.createElement('ul')
    const open = document.createComment(REGION_OPEN)
    const close = document.createComment(REGION_CLOSE)
    host.append(open, close)
    document.body.append(host)

    const selected = reactive('a')
    const rows = reactive(['a', 'b'])
    const make = (made: Document, item: unknown): Node[] => {
        const row = made.createElement('li')
        row.className = selected() === item ? 'danger' : ''
        return [row]
    }
    const list = listAt(
        { open, close },
        false,
        (item) => item,
        () => ({ make, mount: () => new Scope() }),
    )
    let listRuns = 0
    const scope = new Scope()
    scope.watch(() => {
        listRuns += 1
        updateList(list, rows())
    })
    flushSync()
    const built = listRuns
    selected.set('b')
    flushSync()
    expect(listRuns - built).toBe(0)
    scope.stop()
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
    const { mount } = await renderPage(FRESH)
    const sent = [...document.querySelectorAll('#fresh li')]
    mount()
    const kept = [...document.querySelectorAll('#fresh li')].filter(
        (node, at) => node === sent[at],
    )
    expect(sent).toHaveLength(3)
    expect(kept).toHaveLength(3)
})

// 41.10 THROUGH THE COUNTS, which is the only truth hydration has. A hydrating run wires row `at`
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

test('a document holding fewer rows than the client computes reconciles — 41.10', async () => {
    const { mount } = await renderPage(FIVE)
    // THE DIVERGENCE, made by hand because no shape in this suite produces one: the document is
    // short two rows, exactly as a server that rendered against a smaller list would leave it.
    const painted = [...document.querySelectorAll('#five li')]
    expect(painted).toHaveLength(5)
    for (const node of painted.slice(3)) node.remove()
    expect(document.querySelectorAll('#five li')).toHaveLength(3)

    const said: string[] = []
    const warn = console.warn
    console.warn = (...parts: unknown[]): void => {
        said.push(parts.map(String).join(' '))
    }
    try {
        mount()
    } finally {
        console.warn = warn
    }
    expect(
        [...document.querySelectorAll('#five li')].map((n) => n.textContent),
    ).toEqual(['a', 'b', 'c', 'd', 'e'])
    // AND IT SAID SO. Repairing the divergence in silence is 41.10 half applied \u2014 the rows come
    // back either way, so the warning is the only thing that reports a document and a client that
    // disagree. THE REVERT: return `false` from `hydrate` without warning; the rows still arrive
    // and this reports [].
    expect(said.filter((line) => line.includes('41.10'))).toHaveLength(1)
    expect(said.join(' ')).toContain('holds 3 rows')
})

// 41.10 THE OTHER WAY ROUND: the document holds MORE rows than the client computes. The rows past
// the last item have no item, and wiring them anyway handed `undefined` to the key — `row.id` threw
// a TypeError, which is not a `Mismatch`, so the page died instead of warning and rebuilding. The
// divergence is made by hand as above: the server painted five, and a client whose subject is
// three hydrates against those five nodes.
//
// THE REVERT: wire every row the document holds before comparing lengths — the mount throws
// TypeError: undefined is not an object (evaluating 'row.id') and none of this is reached.
const THREE = `<script>
import { reactive } from 'abide'

let rows = reactive([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
</script>

<ul id="three">{#for row of rows by row.id}<li>{row.id}</li>{/for}</ul>`

test('a document holding more rows than the client computes warns and rebuilds — 41.10', async () => {
    const { mount } = await renderPage(THREE)
    const painted = [...document.querySelectorAll('#three li')]
    expect(painted).toHaveLength(3)
    let last = painted[2] as Element
    for (const id of ['d', 'e']) {
        const extra = last.cloneNode(true) as Element
        extra.textContent = id
        last.after(extra)
        last = extra
    }
    expect(document.querySelectorAll('#three li')).toHaveLength(5)

    const said: string[] = []
    const warn = console.warn
    console.warn = (...parts: unknown[]): void => {
        said.push(parts.map(String).join(' '))
    }
    try {
        mount()
    } finally {
        console.warn = warn
    }
    expect(
        [...document.querySelectorAll('#three li')].map((n) => n.textContent),
    ).toEqual(['a', 'b', 'c'])
    expect(said.filter((line) => line.includes('41.10'))).toHaveLength(1)
    expect(said.join(' ')).toContain('holds 5 rows')
})

// 32.32 — A `{#for}` WITH NO KEY OVER A `Reactive` NAMED ALONE KEYS BY THAT VALUE'S `by`. The page
// is `PAGE` with the key moved off the block and onto the value, so the counts are the ones the
// written key earns above.
//
// THE REVERT: emit `written` whatever the subject in `emitList`. The order still comes out right —
// a positional list remakes every row where it stands — and the swap reports 4 nodes created where
// 0 are due.
function byPage(by: string, subject = 'rows'): string {
    return `<script>
import { reactive } from 'abide'

let rows = reactive([
    { id: 'ada', name: 'Ada Lovelace' },
    { id: 'grace', name: 'Grace Hopper' },
    { id: 'katherine', name: 'Katherine Johnson' },
    { id: 'dorothy', name: 'Dorothy Vaughan' },
], { by: ${by} })

function swapTop() {
    const [first, second, ...rest] = rows
    rows = [second, first, ...rest]
}

function reverse() {
    rows = [...rows].reverse()
}
</script>

<ul id="list">{#for row of ${subject}}<li data-id={row.id}>{row.name}</li>{/for}</ul>
<button id="swap" onclick={swapTop}>swap</button>
<button id="reverse" onclick={reverse}>reverse</button>`
}

const nodesById = (): Map<string | null, Element> =>
    new Map(
        [...document.querySelectorAll('#list li')].map((node) => [
            node.getAttribute('data-id'),
            node,
        ]),
    )

test('a {#for} with no key takes the property its value names on `by`', async () => {
    await mountPage(byPage(`'id'`))
    const before = document.querySelectorAll('#list li')[2] as HTMLElement

    const work = measure(() => {
        ;(document.querySelector('#swap') as HTMLElement).click()
        flushSync()
    })

    expect(order()).toEqual(['grace', 'ada', 'katherine', 'dorothy'])
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(1)
    expect(document.querySelectorAll('#list li')[2]).toBe(before)
})

test('a {#for} with no key takes the function its value declares on `by`, and reverses whole', async () => {
    await mountPage(byPage('(row) => row.id'))
    const nodes = nodesById()

    ;(document.querySelector('#reverse') as HTMLElement).click()
    flushSync()

    expect(order()).toEqual(['dorothy', 'katherine', 'grace', 'ada'])
    for (const [id, node] of nodes)
        expect(document.querySelector(`#list li[data-id="${id}"]`)).toBe(node)
})

// A SUBJECT COMPUTED FROM THE VALUE declared no `by` of its own, and stays positional (32.13):
// every row is rewritten where it stands rather than moved.
test('a {#for} over a value computed from one declaring `by` stays positional', async () => {
    await mountPage(byPage(`'id'`, 'rows.slice()'))
    const nodes = nodesById()

    ;(document.querySelector('#reverse') as HTMLElement).click()
    flushSync()

    expect(order()).toEqual(['dorothy', 'katherine', 'grace', 'ada'])
    for (const [id, node] of nodes)
        expect(document.querySelector(`#list li[data-id="${id}"]`)).not.toBe(
            node,
        )
})

// 5.7 — A PATCH MUTATES IN PLACE, so the list's next run finds every key over the SAME object and
// `reconcile` keeps the row. The row's text reads a field of a plain object, which wakes nothing.
//
// THE REVERT, for this and the three 32.33 cases below it: `patchedSince` answering false. Every row
// is kept, and each of the four reports the text it showed before the patch.
test('a row patched in place shows the patch', async () => {
    await mountPage(
        byPage(`'id'`).replace(
            '<button id="reverse"',
            `<button id="rename" onclick={() => rows.patch((list) => { list[1].name = 'Grace Brewster Hopper' })}>rename</button>
<button id="reverse"`,
        ),
    )
    ;(document.querySelector('#rename') as HTMLElement).click()
    flushSync()
    expect(
        document.querySelector('#list li[data-id="grace"]')?.textContent,
    ).toBe('Grace Brewster Hopper')
})

// 32.33 — AND ONLY THAT ROW. The array is written by nothing but a mutation of its own, so the rows
// whose items the patch never reached are the same nodes.
const PATCHED = (subject: string, mutation: string): string => `<script>
import { reactive } from 'abide'

let rows = reactive([
    { id: 'ada', name: 'Ada Lovelace', place: { city: 'London' } },
    { id: 'grace', name: 'Grace Hopper', place: { city: 'New York' } },
    { id: 'katherine', name: 'Katherine Johnson', place: { city: 'Hampton' } },
])
</script>

<ul id="list">{#for row of ${subject} by row.id}<li data-id={row.id}>{row.name}, {row.place.city}</li>{/for}</ul>
<button id="patch" onclick={() => rows.patch((list) => { ${mutation} })}>patch</button>`

const textOf = (id: string): string | null | undefined =>
    document.querySelector(`#list li[data-id="${id}"]`)?.textContent

test('a patch remakes the one row it wrote to and keeps the rest', async () => {
    await mountPage(PATCHED('rows', `list[1].name = 'Grace Brewster Hopper'`))
    const nodes = nodesById()

    const work = measure(() => {
        ;(document.querySelector('#patch') as HTMLElement).click()
        flushSync()
    })

    expect(textOf('grace')).toBe('Grace Brewster Hopper, New York')
    expect(document.querySelector('#list li[data-id="ada"]')).toBe(
        nodes.get('ada') as Element,
    )
    expect(document.querySelector('#list li[data-id="katherine"]')).toBe(
        nodes.get('katherine') as Element,
    )
    // ONE ROW: its `<li>` and the text inside it.
    expect(work.nodesCreated).toBe(2)
})

// THE CASE A KEY ON THE VALUE CANNOT REACH: the list walks a new array built from the value, over the
// same objects, so what was written travels with the object rather than with the value.
test('a list over an array computed from a patched value shows the patch', async () => {
    await mountPage(
        PATCHED(
            'rows.filter(() => true)',
            `list[2].name = 'Katherine G. Johnson'`,
        ),
    )
    ;(document.querySelector('#patch') as HTMLElement).click()
    flushSync()
    expect(textOf('katherine')).toBe('Katherine G. Johnson, Hampton')
})

// A WRITE BELOW THE ROW'S OWN OBJECT. The row reads `row.place.city`, and the object written is
// `place` — so the whole path down to it is what the patch marks.
test('a patch nested below a row remakes that row', async () => {
    await mountPage(PATCHED('rows', `list[0].place.city = 'Marylebone'`))
    ;(document.querySelector('#patch') as HTMLElement).click()
    flushSync()
    expect(textOf('ada')).toBe('Ada Lovelace, Marylebone')
})

test('a patch that adds a row makes that row alone', async () => {
    await mountPage(
        PATCHED(
            'rows',
            `list.push({ id: 'dorothy', name: 'Dorothy Vaughan', place: { city: 'Hampton' } })`,
        ),
    )
    const nodes = nodesById()

    const work = measure(() => {
        ;(document.querySelector('#patch') as HTMLElement).click()
        flushSync()
    })

    expect(order()).toEqual(['ada', 'grace', 'katherine', 'dorothy'])
    // ONE ROW: its `<li>` and the text inside it.
    expect(work.nodesCreated).toBe(2)
    for (const [id, node] of nodes)
        expect(document.querySelector(`#list li[data-id="${id}"]`)).toBe(node)
})

// ONE OBJECT UNDER TWO ROWS, reached through the second only AFTER the write. The early stop in
// `mark` never climbs to a parent it has not met, so a parent met late is marked where it is met.
// THE REVERT: drop the `mark(parent)` at the end of `adopt`, and Grace keeps "Arlington".
test('an object two rows share is fresh in both once the patch reaches it through each', async () => {
    await mountPage(`<script>
import { reactive } from 'abide'

const office = { city: 'Arlington' }
let rows = reactive([
    { id: 'ada', name: 'Ada', place: office },
    { id: 'grace', name: 'Grace', place: office },
])
</script>

<ul id="list">{#for row of rows by row.id}<li data-id={row.id}>{row.name}, {row.place.city}</li>{/for}</ul>
<button id="patch" onclick={() => rows.patch((list) => { list[0].place.city = 'Crystal City'; void list[1].place })}>patch</button>`)
    ;(document.querySelector('#patch') as HTMLElement).click()
    flushSync()
    expect(textOf('ada')).toBe('Ada, Crystal City')
    expect(textOf('grace')).toBe('Grace, Crystal City')
})

// A ROW THAT BINDS NOTHING OPENS NO SCOPE — a hydrated row and a made one alike hold the one shared
// empty scope, so a static row costs no `Scope` and no `stops` array. A count of allocations, not a
// value: a row with a scope of its own renders the same. THE REVERT: emit the scope and `try` for an
// empty body in `mountFunction`; this reports 5 of 5 rows with a scope of their own where 0 are due.
const STATIC_ROWS = `<script>
import { reactive } from 'abide'

let rows = reactive([{ id: 'a' }, { id: 'b' }, { id: 'c' }])

function more() {
    rows = [...rows, { id: 'd' }, { id: 'e' }]
}
</script>

<ul id="static-rows">{#for row of rows by row.id}<li>{row.id}</li>{/for}</ul>
<button id="more" onclick={more}>more</button>`

test('a row that binds nothing allocates no scope, hydrated or made', async () => {
    const { mount } = await renderPage(STATIC_ROWS)
    const page = mount() as Scope
    ;(document.querySelector('#more') as HTMLElement).click()
    flushSync()
    expect(document.querySelectorAll('#static-rows li').length).toBe(5)
    const list = (page.children ?? []).find(
        (child): child is List => child instanceof List,
    ) as List
    const owned = list.rows.filter((row) => row.scope !== EMPTY_SCOPE)
    expect(`${owned.length} of ${list.rows.length} rows own a scope`).toBe(
        `0 of 5 rows own a scope`,
    )
})

// A ROW THAT THROWS WHILE IT IS MADE leaves the list as the document has it. The walk places rows
// from the end, so the rows after the one that threw are already standing when it does.
// THE REVERT, run: without `reconcile`'s catch, `list.rows` kept the dropped `b` and never recorded
// `c` and `d`, so the next reconcile made them again — the document read a, c, d, c, d.
test('a row that throws while made leaves no row unrecorded — 41.14', () => {
    const host = document.createElement('ul')
    const open = document.createComment(REGION_OPEN)
    const close = document.createComment(REGION_CLOSE)
    host.append(open, close)
    document.body.append(host)
    const make = (made: Document, item: unknown): Node[] => {
        if (item === 'boom') throw new Error('boom')
        const row = made.createElement('li')
        row.textContent = String(item)
        return [row]
    }
    const builders = { make, mount: (): Scope => new Scope() }
    const list = listAt(
        { open, close },
        false,
        (item: unknown) => item,
        () => builders,
    )
    const text = (): string[] =>
        [...host.querySelectorAll('li')].map((node) => node.textContent ?? '')

    updateList(list, ['a', 'b'])
    expect(() => updateList(list, ['a', 'boom', 'c', 'd'])).toThrow('boom')
    updateList(list, ['a', 'c', 'd'])
    expect(text()).toEqual(['a', 'c', 'd'])
    host.remove()
})

// A `{#for}` OVER `s.history(n)` IS A READER OF THE VALUE'S PAST, and a publish is what moves it.
// The window's sync face read nothing, so the block painted the ring it found at mount and never
// woke again — Send on the `channel-tail` card changed nothing on screen. Each block holds the
// position it first replayed from (2.5): `history(2)` keeps the two it replayed and gathers every
// arrival after them, `history(0)` gathers arrivals alone, and both lose what the VALUE's retention
// drops (2.6, 6.16) — `history: 3` keeps four.
//
// THE REVERTS, each run: drop the read in `HistoryWindow`'s sync face and the first publish
// reports `[2, 3]` and `[]`; drop `heldFrom` and it reports `[3, 4]` and `[]`, the window sliding;
// drop the retention clamp and the last step reports `[2, 3, 4, 5, 6, 7]`, the ring's untrimmed
// array rather than the four `history: 3` keeps.
const HISTORY_ROWS = `<script>
import { reactive } from 'abide'

const token = reactive<number>(undefined, { history: 3 })
for (const at of [1, 2, 3]) token.publish(at)
let sent = 3

function emit() {
    sent += 1
    token.publish(sent)
}
</script>

<ul id="replayed">{#for at of token.history(2)}<li>{at}</li>{/for}</ul>
<ul id="live">{#for at of token.history(0)}<li>{at}</li>{/for}</ul>
<button id="emit" onclick={emit}>emit</button>`

test('a {#for} over s.history(n) follows the value it reads — 2.5, 2.6', async () => {
    await mountPage(HISTORY_ROWS)
    const shown = (id: string): string[] =>
        [...document.querySelectorAll(`#${id} li`)].map(
            (node) => node.textContent ?? '',
        )
    expect([shown('replayed'), shown('live')]).toEqual([['2', '3'], []])
    const standing = document.querySelector('#replayed li')

    const work = measure(() => {
        ;(document.querySelector('#emit') as HTMLElement).click()
        flushSync()
    })
    expect([shown('replayed'), shown('live')]).toEqual([['2', '3', '4'], ['4']])
    // One row inserted per block, and the rows already standing are the same nodes.
    expect([work.nodesCreated, work.elementsMoved]).toEqual([4, 2])
    expect(document.querySelector('#replayed li')).toBe(standing)

    for (let press = 0; press < 3; press += 1) {
        ;(document.querySelector('#emit') as HTMLElement).click()
        flushSync()
    }
    expect([shown('replayed'), shown('live')]).toEqual([
        ['4', '5', '6', '7'],
        ['4', '5', '6', '7'],
    ])
})

// A SUBSCRIBER'S COPY HAS NOTHING AT HYDRATION. The server painted the owner's ring; the copy in the
// browser is busy until the mux's first frame (9.29), so its window is empty on the client's first
// run — and an empty list against three painted rows was a mismatch, the block rebuilt and a
// warning on `abide:hydrate`. The block's read aborts instead (2.13), the painted rows stand
// (32.23), and the replay is reconciled against them when it lands (41.8). The copy here is what
// `socketWire` builds — a value over a load the first frame settles — and the replay lands in one
// turn, which is what a block needs to read what the server painted.
//
// THE REVERT, run: drop the read in `HistoryWindow`'s sync face. This reports one `abide:hydrate`
// warning ("holds 3 rows where this {#for} computes 0") and an empty list that never fills.
test('a {#for} over a copy that has not landed adopts the rows the server painted — 41.8', async () => {
    const turns = ['ask', 'answer', 'follow-up']
    const side = globalThis as { historySubject?: unknown }
    const owner = reactive<string>(undefined, { history: 100 })
    for (const turn of turns) owner.publish(turn)
    side.historySubject = owner
    const { mount } = await renderPage(`<script>
const transcript = (globalThis as { historySubject?: any }).historySubject
</script>

<ul id="transcript">{#for turn of transcript.history(50)}<li>{turn}</li>{/for}</ul>`)
    const painted = document.querySelector('#transcript li')

    const landed = Promise.withResolvers<unknown>()
    const copy = reactive<string>(landed.promise as Promise<string>, {
        history: 100,
    })
    side.historySubject = copy
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '))
    try {
        mount()
        flushSync()
        // Still busy, so the painted rows are what stands — and what is adopted once it lands.
        await Bun.sleep(0)
        flushSync()
        // The replay in one turn, every production published: a publish lands where a
        // load is in flight, and the load settled after it is superseded.
        for (const turn of turns) copy.publish(turn)
        landed.resolve(turns[0])
        await Bun.sleep(0)
        flushSync()
    } finally {
        console.warn = warn
        side.historySubject = undefined
    }
    expect({
        rows: [...document.querySelectorAll('#transcript li')].map(
            (node) => node.textContent,
        ),
        adopted: document.querySelector('#transcript li') === painted,
        warnings: warned.filter((line) => line.includes('abide:hydrate')),
    }).toEqual({ rows: turns, adopted: true, warnings: [] })
})

// THE SAME ADOPTION OVER THE WIRE, end to end: the owner behind the mux in this process, the copy
// `socketWire` builds in the browser, and each frame arriving in a task of its own as a web socket's
// do. Both halves are what put the ring in the copy in ONE turn — the mux sends the replay as one
// frame, and the copy publishes each entry rather than settling its load with the first.
//
// THE REVERTS, each run: send the ring a `prod` frame per entry in `subscribe` and the copy lands
// the first turn alone — rows `['ask']` and one `abide:hydrate` warning ("holds 3 rows where this
// {#for} computes 1"); resolve the load before publishing in `deliver` and the first entry is
// superseded by the publish after it — rows `['answer', 'follow-up']` and the same warning.
test('a {#for} over a socket copy adopts the rows the server painted, over the mux — 41.8, 41.10', async () => {
    const { Mux } = await import('#server/answerSocket.ts')
    const { socket } = await import('#shared/socket.ts')
    const { MUXES, socketWire } = await import('#ui/socketWire.ts')
    const address = '/__abide/socket/transcript'
    const turns = ['ask', 'answer', 'follow-up']
    const owner = reactive<string>(undefined, { history: 100, global: true })
    for (const turn of turns) owner.publish(turn)
    const mux = new Mux(
        new Map([[address, socket(owner as never)]]) as never,
        new Map(),
        undefined,
    )
    // A web socket whose far end is the mux above: every frame either way is its own task. A frame
    // down is delivered OUTSIDE the connection's request scope, as a browser's is — a timer set
    // inside it carries that scope, and the copy's publishes land in the scope's own copy instead.
    const outside = AsyncLocalStorage.snapshot()
    class LoopbackSocket {
        static OPEN = 1
        readyState = 0
        onopen: (() => void) | null = null
        onmessage: ((event: { data: string }) => void) | null = null
        onclose: (() => void) | null = null
        onerror: (() => void) | null = null
        down: string[] = []
        connection = mux.connect(
            new Request('http://app.test/__abide/socket'),
            {
                send: (text: string) => {
                    this.down.push(text)
                    if (this.down.length === 1) this.deliverDown()
                },
                close() {},
            },
        )
        // One frame per task, the next not before the last was handled.
        deliverDown(): void {
            setTimeout(
                () =>
                    outside(() => {
                        this.onmessage?.({ data: this.down.shift() as string })
                        if (this.down.length !== 0) this.deliverDown()
                    }),
                1,
            )
        }
        constructor() {
            setTimeout(() => {
                this.readyState = 1
                this.onopen?.()
            }, 0)
        }
        send(text: string): void {
            setTimeout(() => void this.connection.message(text), 0)
        }
    }
    const side = globalThis as { historySubject?: unknown; WebSocket: unknown }
    side.historySubject = owner
    const { mount } = await renderPage(`<script>
const transcript = (globalThis as { historySubject?: any }).historySubject
</script>

<ul id="transcript">{#for turn of transcript.history(50)}<li>{turn}</li>{/for}</ul>`)
    const painted = document.querySelector('#transcript li')

    const realSocket = side.WebSocket
    side.WebSocket = LoopbackSocket
    // THE MUX IS THIS CASE'S, whatever ran first: a page's muxes stand for its life, so one an
    // earlier file in this process opened — over a stub socket that never opens — would carry the
    // copy instead. THE REVERT: drop the clear; after `wire.test.ts` in one process this reports
    // `landed: false`.
    MUXES.clear()
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '))
    const copy = (socketWire(address) as () => { busy(): boolean })()
    try {
        side.historySubject = copy
        mount()
        flushSync()
        for (let task = 0; task < 20 && copy.busy(); task += 1) {
            await Bun.sleep(1)
            flushSync()
        }
        await Bun.sleep(1)
        flushSync()
    } finally {
        console.warn = warn
        side.WebSocket = realSocket
        side.historySubject = undefined
        MUXES.clear()
    }
    expect({
        rows: [...document.querySelectorAll('#transcript li')].map(
            (node) => node.textContent,
        ),
        adopted: document.querySelector('#transcript li') === painted,
        warnings: warned.filter((line) => line.includes('abide:hydrate')),
        landed: !copy.busy(),
    }).toEqual({ rows: turns, adopted: true, warnings: [], landed: true })
})

// A `{#for}` OVER A STREAM'S `s.history(n)` reads the runs that CLOSED (6.17), and a close is not a
// chunk: the block woke on each chunk through its read of the value and then never for the close
// that entered the run into the past, so the run it was waiting for never painted.
//
// THE REVERT, run: drop the subscription to the past in `HistoryWindow`'s sync face. This reports
// `[]` after the first close rather than `['ab']`, and `['ab']` after the second rather than
// `['ab', 'c']`.
test('a {#for} over a stream’s s.history(n) paints each run as it closes — 6.17, 2.5', async () => {
    const side = globalThis as { historySubject?: unknown }
    side.historySubject = reactive<string[]>(undefined, { history: 3 })
    const { mount } = await renderPage(`<script>
const runs = (globalThis as { historySubject?: any }).historySubject
</script>

<ul id="runs">{#for run of runs.history(3)}<li>{run.join('')}</li>{/for}</ul>`)
    // Each run is a queue the test fills, and closes by pushing `null`.
    let queue: (string | null)[] = []
    let wake = (): void => {}
    const feed = reactive(
        async function* () {
            queue = []
            for (;;) {
                while (queue.length === 0)
                    await new Promise<void>((resolve) => {
                        wake = resolve
                    })
                const chunk = queue.shift() as string | null
                if (chunk === null) return
                yield chunk
            }
        },
        { history: 3 },
    )
    const send = async (...chunks: (string | null)[]): Promise<void> => {
        for (const chunk of chunks) {
            queue.push(chunk)
            wake()
            for (let turn = 0; turn < 5; turn += 1) await Bun.sleep(0)
        }
        flushSync()
    }
    const shown = (): string[] =>
        [...document.querySelectorAll('#runs li')].map(
            (node) => node.textContent ?? '',
        )
    side.historySubject = feed
    try {
        mount()
        flushSync()
        await send('a', 'b')
        const midRun = shown()
        await send(null)
        const firstClosed = shown()
        feed.refresh()
        await send('c', null)
        expect({ midRun, firstClosed, secondClosed: shown() }).toEqual({
            midRun: [],
            firstClosed: ['ab'],
            secondClosed: ['ab', 'c'],
        })
    } finally {
        side.historySubject = undefined
    }
})
