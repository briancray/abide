// A REGION INSIDE A REGION, AND A RUN THAT RENDERED NOTHING. Both are the same mechanism — how a
// path is addressed against a document somebody already rendered — and both were unreachable
// ground: every corpus example is nesting-depth 1 and no fixture nested one, so `{#if}` inside an
// arm, `{#for}` inside an arm, either inside a ROW, and a sibling after any of them all took the
// page's whole hydration down with `region 0 is not in the rendered document`.
//
// WHAT THEY HAVE IN COMMON is that the root a path starts from is not always a NODE: the page's is,
// an arm's is its own anchor pair, and a row's is the array the reconcile handed back. The walk
// starts from each of them and is the same walk after its first step, and a sibling AFTER a
// region is found from the region's closing anchor wherever the region stands.
//
// A BLANK RUN is the other half: every part of it is an expression, so a value that stringifies to
// `''` writes NO node and every node after it in that parent stands one place early. The compiler
// knows which runs those are and the walk puts the node back as it passes (`runHere`), which is
// what makes everything after it where the rest of the page expects it.

import { afterAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { parseAbide } from '#compiler'
import { emitSource } from '#compiler/emitSource.ts'
import { flushSync } from '#shared'
import { pageRegion } from '#ui/regions.ts'
import type { Scope } from '#ui/Scope.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'
import {
    clientOf,
    closeTyped,
    mountPage,
    renderPage,
    TYPED_ROOT,
    typedSession,
} from './typed.ts'

afterAll(closeTyped)

const session = await typedSession()
afterAll(removeTemporaryModules)

const click = (id: string): void => {
    ;(document.querySelector(id) as HTMLElement).click()
    flushSync()
}

// Everything `console.warn` was told while the body ran. 41.10's warning is the only thing the
// clause leaves visible when a block rebuilds, so a test that does not read it is reading the
// output of a page that may have been rebuilt three times.
async function warningsWhile(body: () => Promise<void>): Promise<string[]> {
    const said: string[] = []
    const warn = console.warn
    console.warn = (...parts: unknown[]): void => {
        said.push(parts.map(String).join(' '))
    }
    try {
        await body()
    } finally {
        console.warn = warn
    }
    return said
}

// A NESTED REGION IS FOUND FROM THE ARM THAT HOLDS IT. The arm's root is its own anchor pair, handed
// to the arm's mount as `__root`, and the walk inside it starts at the pair's opening anchor.
//
// THE REVERT: default a nested sink's head to the name the ENCLOSING walk gave the region
// (`${at.name}.open.nextSibling` in `Cursor.nest`). The arm's slots restart at `__c0`, so that name
// is one of the arm's own, read before it is declared, and the arm's first mount throws.
test('an {#if} inside an arm is found, and its binding is live', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let outer = reactive(true)
let inner = reactive(true)
let name = reactive('ada')
</script>

<div>{#if outer}<p>x</p>{#if inner}<i id="deep">{name}</i>{/if}{/if}</div>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])
    expect((document.querySelector('#deep') as HTMLElement).textContent).toBe(
        'ada',
    )

    // Walked from the ARM'S OWN anchors, then past the `<p>` to the inner pair.
    const client = await clientOf(source, ['outer', 'inner', 'name'])
    expect(client).toContain('const __c0 = __root.open.nextSibling')
    expect(client).toContain('const __c2 = __regionHere(__c0?.nextSibling)')
})

// THE SAME PROPERTY FROM A ROW, whose root is an ARRAY rather than an anchor pair — and a sibling
// AFTER the nested region, which is the pair `[-1, 0]` resolved against that array.
//
// THE REVERT: the same one. The region is then looked for inside the row's own opening anchor —
// a comment with no children — and this reports two `abide:hydrate abide: region 0 is not in the
// rendered document ... (41.10)` warnings where none is due, with neither row wired.
test('an {#if} inside a {#for} row is found, and so is the sibling after it', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let rows = reactive([{ id: 'a', on: true }, { id: 'b', on: false }])
</script>

<ul id="list">{#for row of rows by row.id}{#if row.on}<b>on</b>{/if}<span>{row.id}</span>{/for}</ul>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])
    expect(
        [...document.querySelectorAll('#list span')].map(
            (node) => node.textContent,
        ),
    ).toEqual(['a', 'b'])
    expect(document.querySelectorAll('#list b')).toHaveLength(1)
})

// A RUN AFTER A NESTED REGION, inside the arm that holds both. The arm's root is its own anchor
// pair — a record, not a node — and reading it as a node is the crash a walk used to take.
//
// THE REVERT: start a nested sink's walk at `__root.firstChild` in `Cursor.nest`, reading the pair
// as a node. The walk carries `undefined` from there, every unit in the arm refuses, the arm
// rebuilds and refuses again, and `xy1` is never written.
test('a run after a nested region is bound against the arm', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let open = reactive(true)
let count = reactive(1)
</script>

<section id="hold">{#if open}<b>x</b>{#if open}y{/if}{count}{/if}</section>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])
    const hold = document.querySelector('#hold') as HTMLElement
    expect(hold.textContent).toBe('xy1')
})

// A SIBLING AFTER A REGION, INSIDE AN ELEMENT. How many nodes stand between a region's anchors
// depends on a value, so what follows one is found from its CLOSING anchor — wherever the region
// stands, not only at the page's top level.
//
// THE REVERT: continue past a region from its OPENING anchor in `Cursor.region`. The `<em>` is
// then looked for at the arm's `<b>`, the `{count}` binding lands on `<b>`'s text — a text node
// where a text node was due, so no kind check refuses it — and `<b>` reads `1` where `y` is due.
// Nothing warns, which is why the `<b>` is asserted as well as the tail.
test('a sibling after a region inside an element is found from its close', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let open = reactive(true)
let count = reactive(1)
</script>

<div>x{#if open}<b>y</b>{/if}<em id="tail">{count}</em></div>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])
    const tail = document.querySelector('#tail') as HTMLElement
    expect(tail.textContent).toBe('1')
    expect((document.querySelector('b') as HTMLElement).textContent).toBe('y')

    const client = await clientOf(source, ['open', 'count'])
    expect(client).toContain('const __c3 = __c2?.close?.nextSibling')
})

// A BLANK RUN RENDERS NO NODE, and the sibling after it then stands where the run was. The server
// wrote `<p><b>x</b></p>` for a page whose author wrote `<p>{msg}<b>x</b></p>`, so `[0,0]` is the
// `<b>` — and the binding has nowhere to write.
//
// THE REVERT: walk the run as a plain step rather than through `runHere` in `emitRegion`, so
// nothing is put back and the unit is handed the `<b>`. This reports one `abide:hydrate abide:
// text was due where the server wrote none ... (41.10)` where none is due, and `<p>` holding one
// child where two are.
test('a blank run gets its node back, at the position it belongs', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let msg = reactive('')
</script>

<p id="out">{msg}<b>x</b></p>`

    const said = await warningsWhile(async () => {
        const { html } = await mountPage(source)
        // The SERVER wrote nothing for the run, which is what makes this case exist at all.
        expect(html).toContain('<p id="out"><b>x</b></p>')
    })
    expect(said).toEqual([])

    const out = document.querySelector('#out') as HTMLElement
    expect(out.childNodes.length).toBe(2)
    expect(out.childNodes[0]?.nodeType).toBe(3)
    expect(out.textContent).toBe('x')
})

// THE SAME RUN WITH SOMETHING AFTER IT TOO, which is the case the old fallback answered WRONGLY
// rather than not at all: it appended the missing node to the END of the parent, so the run after
// it found that node and the page rendered one value twice.
//
// THE REVERT: append at the end of the parent in `runHere` — `insertBefore(made, null)` rather
// than before the node the walk stands on. `#out` then reads `x00` where `x0` is due: the trailing
// run finds the node the blank one made at the end of the parent and writes into it.
test('a blank run does not steal the node of the run after it', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let label = reactive('')
let count = reactive(0)
</script>

<p id="out">{label}<b>x</b>{count}</p>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])

    const out = document.querySelector('#out') as HTMLElement
    expect(out.textContent).toBe('x0')
    expect(out.childNodes.length).toBe(3)
})

// AN ANCHOR WALKS THROUGH THE SAME INDEX, which is why the run that fills a blank position is
// emitted in DOCUMENT ORDER beside the anchors rather than after them. `<b>` is `[0,1]` in the
// template and `[0,0]` in the document until the blank run's node is back.
//
// THE REVERT: sort the addresses so every anchor comes before every run in `emitRegion`, which is
// what it did. The anchor then walks a `<p>` holding one child and this reports one
// `abide:hydrate abide: no node at [1] ... (41.10)` where none is due, `#one` and `#two` unwired.
test('an anchor past a blank run is walked after the run is filled', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let msg = reactive('')
let a = reactive('A')
let b = reactive('B')
</script>

<p id="out">{msg}<b><i id="one">{a}</i><i id="two">{b}</i></b></p>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])
    expect((document.querySelector('#one') as HTMLElement).textContent).toBe(
        'A',
    )
    expect((document.querySelector('#two') as HTMLElement).textContent).toBe(
        'B',
    )
})

// A RUN THAT READS NOTHING REACTIVE OPENS NO BINDING — but a BLANK one is still addressed, because
// the node it is missing is what every later index in that parent counts through. The run itself
// never changes; what it costs is one line at mount and nothing after.
//
// THE REVERT: walk the run as a plain `nextSibling` step rather than through `runHere` in
// `emitRegion`. Nothing is put back, the `<b>` is then looked for where the run should have been,
// and this reports one `abide:hydrate ... (41.10)` where none is due.
test('a static blank run is addressed even though it is never bound', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

const nothing = ''
let a = reactive('A')
</script>

<p id="out">{nothing}<b id="in">{a}</b></p>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])
    expect((document.querySelector('#in') as HTMLElement).textContent).toBe('A')

    // WALKED, and NOT bound: put back as the walk passes, because `<b>` is found from it — and no
    // `setText` around it and no second watch.
    const client = await clientOf(source, ['a'])
    expect(client).toContain('const __c1 = __runHere(__c0?.firstChild, __c0)')
    expect(client).toContain('const __c2 = __c1?.nextSibling')
    expect(client).not.toContain('__t1')
    expect(client.match(/watch(Effect)?\(/g) ?? []).toHaveLength(1)
})

// 41.10 — A MISMATCH REBUILDS THE ENCLOSING BLOCK AND WARNS, and rebuilds NOTHING WIDER. The
// document is corrupted between the render and the mount, which is what a real mismatch is: the
// client's plan and the served nodes disagree, and the clause says the block re-renders rather
// than the page throwing.
//
// THE REVERT: drop the `try`/`catch` from the emitted `rgN_mount` in `emitBlock`. The mismatch then
// reaches the page's own catch, which 41.10 forbids rebuilding, and this reports `#body` NULL
// where the re-rendered `<p>` is due — one block's failure taking the block away for good.
test('a mismatch inside a block rebuilds the block and warns', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let open = reactive(true)
let name = reactive('ada')
</script>

{#if open}<p id="body">hello {name}</p>{/if}
<footer id="foot">{name}</footer>
<button id="rename" onclick={() => name = name + '!'}>rename</button>`

    const { mount } = await renderPage(source)

    // The corruption: the arm's own node, replaced by one of a shape the plan does not describe.
    // Everything outside the region is untouched.
    const wrong = document.createElement('b')
    ;(document.querySelector('#body') as HTMLElement).replaceWith(wrong)

    const said = await warningsWhile(async () => {
        mount()
    })

    expect(said).toHaveLength(1)
    expect(said[0]).toContain('abide:hydrate')
    expect(said[0]).toContain('41.10')

    // THE BLOCK CAME BACK, wired, and the page around it never stopped working.
    const body = document.querySelector('#body') as HTMLElement
    expect(body).not.toBeNull()
    expect(body.textContent).toBe('hello ada')
    expect(document.querySelector('b')).toBeNull()

    // WIRED, not merely present: the rebuilt arm's binding wakes with the rest of the page.
    ;(document.querySelector('#rename') as HTMLElement).click()
    flushSync()
    expect((document.querySelector('#body') as HTMLElement).textContent).toBe(
        'hello ada!',
    )
    expect((document.querySelector('#foot') as HTMLElement).textContent).toBe(
        'ada!',
    )
})

// AN AUTHOR'S OWN THROW IS NOT A MISMATCH and comes straight back out. The catch 41.10 asks for is
// a brand test, not a blanket one — a page that swallows every throw at mount is a page whose
// first bug is invisible.
//
// THE REVERT: drop the `instanceof Mismatch` test in `warnMismatch` so every throw reads as one.
// This reports the thrown message as `""` where `boom` is due — an author's first bug, swallowed
// by the catch written for a mismatch.
test('a throw that is not a mismatch is not swallowed', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
const boom = (): string => {
    throw new Error('boom')
}
</script>

<p id="out">{boom()}{count}</p>`

    const file = parseAbide(source)
    const names = await session.reads(`${TYPED_ROOT}src/index.abide`, file)
    const { server, client } = emitSource(
        'index.abide',
        file,
        names,
        false,
    )
    const dir = temporaryModule({ 'Page.ts': server, 'Page.client.ts': client })
    document.body.innerHTML = '<!--[--><p id="out">0</p><!--]-->'
    const { default: mount } = await import(`${dir}/Page.client.ts`)

    let thrown = ''
    const said = await warningsWhile(async () => {
        try {
            mount(pageRegion(document.body))
        } catch (error) {
            thrown = (error as Error).message
        }
    })
    expect(thrown).toBe('boom')
    // 12.6 warns on `abide:watch` for the binding's throw; a mismatch would warn on `abide:hydrate`.
    expect(said.filter((line) => !line.includes('abide:watch'))).toEqual([])
})

// A BLANK RUN AT AN ARM'S OWN TOP LEVEL. The position it belongs at is inside a region, between
// two anchors and under no element of its own, so the node goes in before whatever moved up into
// it — or before the closing anchor where nothing did.
//
// THE REVERT: insert at the end of the region's PARENT (`insertText(parent, null)`) rather than at
// the position. The text node lands after the region's closing anchor, outside the arm entirely,
// and this reports `#hold` reading `xhi` where `hix` is due — with the value outside the block
// that owns it, so the next swap leaves it behind.
test('a blank run inside an arm gets its node between the anchors', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let open = reactive(true)
let msg = reactive('')
</script>

<section id="hold">{#if open}{msg}<b>x</b>{/if}</section>
<button id="say" onclick={() => msg = 'hi'}>say</button>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])

    const hold = document.querySelector('#hold') as HTMLElement
    expect(hold.textContent).toBe('x')
    ;(document.querySelector('#say') as HTMLElement).click()
    flushSync()
    expect(hold.textContent).toBe('hix')
})

// A BLANK RUN AT A ROW'S OWN TOP LEVEL. The walk puts the run back into the document after the row
// was made, so a row held as the nodes it was made or hydrated with leaves it behind on the first
// reorder. A row with several top-level nodes is the RANGE from its anchor, which the run lands in.
//
// THE SPAN READS A PAGE-LEVEL `Reactive` ON PURPOSE. A row whose slots read only its item binds
// nothing, so its walk is pruned away whole and nothing is ever put back — the case would pass
// with the array wrong. And `textContent` cannot see an EMPTY text node left behind, so what is
// asserted is where each row's run stands after the swap.
//
// THE REVERT: move an anchored row by the nodes `rowsIn` hydrated it with rather than by its range
// (`moveRow`). The swap moves the row without its run, and this reports a `<span>` whose previous
// sibling is the row's anchor rather than its run.
test('a blank run inside a row moves with the row', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let mark = reactive('')
let rows = reactive([
    { id: 'a', tag: '' },
    { id: 'b', tag: '' },
])

function swap() {
    const [first, second] = rows
    rows = [second, first]
}
</script>

<ul id="list">{#for row of rows by row.id}{row.tag}<span>{row.id}{mark}</span>{/for}</ul>
<button id="swap" onclick={swap}>swap</button>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])

    const list = document.querySelector('#list') as HTMLElement
    expect(list.textContent).toBe('ab')
    ;(document.querySelector('#swap') as HTMLElement).click()
    flushSync()
    expect(list.textContent).toBe('ba')
    // Each row is its anchor, its run and its `<span>`, in that order, and nothing is left over.
    const kinds: string[] = []
    for (const node of list.childNodes)
        kinds.push(
            node.nodeType === 3
                ? 'text'
                : node.nodeType === 8
                  ? 'anchor'
                  : node.nodeName,
        )
    expect(kinds).toEqual([
        'anchor',
        'anchor',
        'text',
        'SPAN',
        'anchor',
        'text',
        'SPAN',
        'anchor',
    ])
})

// 41.10 IN A ROW. The block that rebuilds is the ROW, and nothing outside it is touched — which is
// what `replaceRow` is for: the fresh nodes go in where the old ones were AND the row's record takes
// the new first node, so the row is still one row afterwards.
//
// The row's run carries a STATIC piece on purpose — a blank run is one the walk puts back rather
// than refuses — and reads a page-level reactive, because a slot reading only the loop ITEM is written
// by the markup and never bound at all.
//
// THE REVERT: drop the `try`/`catch` from the emitted `lsN_mount` in `emitList`. The mismatch
// reaches the page's own catch, and this reports `document.querySelector('#list b')` non-null —
// the corrupted node still in the list — where the rebuilt `<li>id p-b</li>` is due.
test('a mismatch inside a row rebuilds the row and warns', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let rows = reactive([{ id: 'a' }, { id: 'b' }])
let prefix = reactive('p')
</script>

<ul id="list">{#for row of rows by row.id}<li>id {prefix}-{row.id}</li>{/for}</ul>`

    const { mount } = await renderPage(source)

    // One row's node, replaced by a shape the row's plan does not describe.
    const wrong = document.createElement('b')
    ;(document.querySelectorAll('#list li')[1] as HTMLElement).replaceWith(
        wrong,
    )

    const said = await warningsWhile(async () => {
        mount()
    })

    expect(said).toHaveLength(1)
    expect(said[0]).toContain('abide:hydrate')
    expect(document.querySelector('#list b')).toBeNull()
    expect(
        [...document.querySelectorAll('#list li')].map(
            (node) => node.textContent,
        ),
    ).toEqual(['id p-a', 'id p-b'])
})

// A ROW'S NODES ARE THE ROW, and a blank run put back INSIDE a row's element is not one of them:
// the node goes inside that element and stays there. When a row was an array of nodes that the
// walk added to, one added from inside the element was hoisted OUT of it on the first reorder and
// deleted out of it on the row's removal. A single-root row is its element now and nothing is
// added to it, so this holds by construction; it stays as the shape that once broke.
//
// The region before the run is what makes the case: it is the shape that once put a path through a
// region reference inside a row element, and it puts the walk one frame inside the row here.
test('a blank run inside a row element does not join the row', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let mark = reactive('')
let rows = reactive([{ id: 'a' }, { id: 'b' }])

function swap() {
    const [first, second] = rows
    rows = [second, first]
}
</script>

<ul id="list">{#for row of rows by row.id}<li id={row.id}>{#if row.id}<b>{row.id}</b>{/if}{mark}</li>{/for}</ul>
<button id="swap" onclick={swap}>swap</button>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])
    click('#swap')

    const list = document.querySelector('#list') as HTMLElement
    const top: string[] = []
    for (const node of list.childNodes)
        top.push(node.nodeType === 8 ? 'anchor' : node.nodeName)
    expect(top).toEqual(['anchor', 'LI', 'LI', 'anchor'])
    // Each run is where it was put back: the last child of its own `<li>`.
    for (const item of list.querySelectorAll('li'))
        expect(item.lastChild?.nodeType).toBe(3)
})

// 12.13 — A REGION STOPS EVERY SCOPE OPENED BENEATH IT. A row's own disposers were always stopped
// when the row left, but an arm or a list standing INSIDE that row opens a scope of its own, and
// nothing reached those: `Scope.stop` walked its own `stops` and stopped. The dropped row's arm
// went on waking for every write and writing into nodes no longer in the document.
//
// THE WORK IS THE ASSERTION, because the output cannot see it — the detached nodes are gone from
// the page whether or not anything is still writing into them, so the page reads correct either
// way. THE REVERT for both: drop the `children` walk from `Scope.stop`. `bindingRuns` reads 2
// where 1 is due, and it is 2 whatever the page shows.
test('a row that leaves stops an {#if} arm opened inside it — 12.13', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let rows = reactive(['one', 'two'])
let mark = reactive('')
let on = reactive(true)
</script>

<ul>{#for row of rows by row}<li>{#if on}<b>{row + mark}</b>{/if}</li>{/for}</ul>
<button id="drop" onclick={() => { rows = ['one'] }}>drop</button>
<button id="bump" onclick={() => { mark = '!' }}>bump</button>`)
    flushSync()
    expect(document.querySelectorAll('b')).toHaveLength(2)
    click('#drop')
    expect(document.querySelectorAll('b')).toHaveLength(1)

    // ONE ARM IS LEFT, so one binding may run. The dropped row's arm reads `mark` too.
    const work = measure(() => {
        click('#bump')
    })
    expect(work.bindingRuns).toBe(1)
    expect(document.querySelector('b')?.textContent).toBe('one!')
})

// The same clause for the other nested region: a `{#for}` removed WHOLE drops no rows, so
// `dropRow` — which is what stops a row as a list churns — never runs for any of them.
test('a row that leaves stops a {#for} opened inside it — 12.13', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let rows = reactive(['one', 'two'])
let mark = reactive('')
let inner = reactive(['x'])
</script>

<ul>{#for row of rows by row}<li>{#for i of inner by i}<b>{row + i + mark}</b>{/for}</li>{/for}</ul>
<button id="drop" onclick={() => { rows = ['one'] }}>drop</button>
<button id="bump" onclick={() => { mark = '!' }}>bump</button>`)
    flushSync()
    expect(document.querySelectorAll('b')).toHaveLength(2)
    click('#drop')
    expect(document.querySelectorAll('b')).toHaveLength(1)

    const work = measure(() => {
        click('#bump')
    })
    expect(work.bindingRuns).toBe(1)
    expect(document.querySelector('b')?.textContent).toBe('onex!')
})

// 12.13 — AND THE WATCHES A BRANCH-LOCAL `<script>` OPENED (14.8). The arm's or the row's scope is
// made before the script runs and collects its watches (`scopedSetup`); left where nothing held them, a closed arm's or a dropped row's watch went on
// waking at every write. COUNTED PER INSTANCE, because the server's render ran these scripts too,
// in this process. THE REVERT for both: drop `owned` from `watch` — the closed arm's and the
// dropped row's disposers run 0 times where 1 is due, and their watches wake again at the bump.
type Instance = { name: string; runs: number; disposed: number }
const COUNTED = `const instance = { name: NAME, runs: 0, disposed: 0 }
;((globalThis as { instances?: { name: string; runs: number; disposed: number }[] }).instances ??= []).push(instance)
watch(() => {
    mark
    instance.runs += 1
    return () => {
        instance.disposed += 1
    }
})`

function lastInstance(name: string): Instance {
    const instances = (globalThis as { instances?: Instance[] }).instances ?? []
    return instances.findLast((one) => one.name === name) as Instance
}

test('an arm that closes stops the watch its <script> opened — 12.13', async () => {
    await mountPage(`<script>
import { reactive, watch } from '@abide/abide'

let mark = reactive('')
let on = reactive(true)
</script>

{#if on}<script>
${COUNTED.replace('NAME', "'arm'")}
</script><b>arm</b>{/if}
<button id="close" onclick={() => { on = false }}>close</button>
<button id="bump" onclick={() => { mark = '!' }}>bump</button>`)
    flushSync()
    const arm = lastInstance('arm')
    expect(arm.runs).toBe(1)

    click('#close')
    expect(arm.disposed).toBe(1)
    click('#bump')
    expect(arm).toEqual({ name: 'arm', runs: 1, disposed: 1 })
})

test('a row that leaves stops the watch its <script> opened — 12.13', async () => {
    await mountPage(`<script>
import { reactive, watch } from '@abide/abide'

let rows = reactive(['one', 'two'])
let mark = reactive('')
</script>

<ul>{#for row of rows by row}<script>
${COUNTED.replace('NAME', 'row')}
</script><li>{row}</li>{/for}</ul>
<button id="drop" onclick={() => { rows = ['one'] }}>drop</button>
<button id="bump" onclick={() => { mark = '!' }}>bump</button>`)
    flushSync()
    const one = lastInstance('one')
    const two = lastInstance('two')

    click('#drop')
    expect(two.disposed).toBe(1)
    click('#bump')
    expect(two).toEqual({ name: 'two', runs: 1, disposed: 1 })
    expect(one).toEqual({ name: 'one', runs: 2, disposed: 1 })
})

// A SCRIPT THAT THROWS answers no scope for anything to hold, so its own scope is stopped there.
// Under a `{#try}` each retry runs the script again, and every run's watch was left awake behind
// the catch. THE REVERT: drop the `catch` from `scopedSetup` — every instance is disposed 0 times
// where 1 is due, and each wakes again at the bump.
test('a <script> that throws stops the watch it opened first — 12.13', async () => {
    await mountPage(`<script>
import { reactive, watch } from '@abide/abide'

let mark = reactive('')
let on = reactive(false)
</script>

{#try}{#if on}<script>
${COUNTED.replace('NAME', "'thrower'")}
throw new Error('arm')
</script><b>arm</b>{/if}{:catch failure}<p id="caught">caught</p>{/try}
<button id="open" onclick={() => { on = true }}>open</button>
<button id="bump" onclick={() => { mark = '!' }}>bump</button>`)
    flushSync()
    click('#open')
    expect(document.querySelector('#caught')).not.toBeNull()
    const thrown = (
        (globalThis as { instances?: Instance[] }).instances ?? []
    ).filter((one) => one.name === 'thrower')
    expect(thrown.length).toBeGreaterThan(0)
    click('#bump')
    for (const one of thrown)
        expect(one).toEqual({ name: 'thrower', runs: 1, disposed: 1 })
})

// 32.16 — A COMPONENT WHOSE SETUP THROWS, IN AN ARM, UNDER A `{#try}`, SHOWS THE CATCH AND STOPS
// THERE. The swap recorded its arm before mounting it, so the retry — this arm's watch run again —
// found nothing to do, the boundary read that as recovered, and the body was remounted to throw
// again: no turn between, so the tab froze. THE REVERT: move `${name}_at = next` back above the
// arm in `emitBlock`'s swap — `kidRuns` reaches 26, where the guard stops the setup throwing, and the
// catch never shows.
test('a component that throws in an arm under {#try} shows the catch, once — 32.16', async () => {
    const counted = globalThis as { kidRuns?: number }
    counted.kidRuns = 0
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let on = reactive(false)
</script>

{#component Kid()}<script>
const counted = globalThis as { kidRuns?: number }
counted.kidRuns = (counted.kidRuns ?? 0) + 1
// The guard that lets the revert end: past 25 runs the setup stops throwing and the kid mounts.
if (counted.kidRuns <= 25) throw new Error('kid')
</script><i>kid</i>{/component}
{#try}{#if on}<Kid/>{/if}{:catch failure}<p id="caught">{failure.message}</p>{/try}
<button id="open" onclick={() => { on = true }}>open</button>`)
    flushSync()
    click('#open')
    expect(document.querySelector('#caught')?.textContent).toBe('kid')
    expect(counted.kidRuns).toBeLessThan(5)
})

// 10.5 — A BRANCH-LOCAL `<script>` IS INSIDE ITS INSTANCE'S SHARE SCOPE ON EVERY RUN, not just the
// hydrating one. A later swap or a grown row runs it from a `watch` effect with no scope current,
// so `reactive.share` threw "outside a component instance", the watch stopped (12.8) and the arm or
// row never rendered. THE REVERT: drop `resumes` from `emitArms`' and `rowSetUp`'s `scopedSetup`
// — the reopened arm is missing and the grown row is too.
test('an arm reopened and a row grown read the share their page holds — 10.5', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

reactive.share('theme', () => reactive('dark'))
let on = reactive(true)
let rows = reactive(['one'])
</script>

{#if on}<script>
const theme = reactive.share('theme', () => reactive('arm-own'))
</script><b>{theme}</b>{/if}
<ul>{#for row of rows by row}<script>
const theme = reactive.share('theme', () => reactive('row-own'))
</script><li>{row} {theme}</li>{/for}</ul>
<button id="flip" onclick={() => { on = !on }}>flip</button>
<button id="grow" onclick={() => { rows = [...rows, 'two'] }}>grow</button>`)
    flushSync()
    click('#flip')
    click('#flip')
    expect(document.querySelector('b')?.textContent).toBe('dark')
    click('#grow')
    expect(
        [...document.querySelectorAll('li')].map((row) => row.textContent),
    ).toEqual(['one dark', 'two dark'])
})

// 10.5 — CHILDREN ARE DESCENDANTS OF THE COMPONENT THAT RENDERS THEM, in the browser as on the
// server. A `<Section>` slotted into a `<Doc>` finds the list `Doc` shares: the server built it inside
// `Doc` and listed both, and the browser mounted it in its CALLER's scope, so it filled a list of its
// own and the rail the server painted emptied as the page hydrated. THE REVERT: drop `true` from
// `emitFillable(kids, children, region, true)`; the rail reads '' once mounted.
test('children slotted into a component find the share it holds — 10.5', async () => {
    const DOC = `<script>
import { reactive } from '@abide/abide'

const headings = reactive.share('headings', () => reactive<string[]>([]))
</script>

<main><slot/></main>
<aside id="rail">{headings.join('|')}</aside>`
    const SECTION = `<script>
import { props, reactive } from '@abide/abide'

const { title } = props<{ title: string }>()
let headings = reactive.share('headings', () => reactive<string[]>([]))
headings = [...headings, title]
</script>

<h2>{title}</h2>`
    const { html } = await mountPage(
        `<script>
import Doc from './Doc.abide'
import Section from './Section.abide'
</script>

<Doc><Section title="one"/><Section title="two"/></Doc>`,
        { Doc: DOC, Section: SECTION },
    )
    expect(html).toContain('<aside id="rail">one|two</aside>')
    expect(document.querySelector('#rail')?.textContent).toBe('one|two')
})

// 12.14 — A ROW THAT LEAVES LETS GO OF WHAT ITS VALUES READ. A `reactive` a row's
// `<script>` built stayed on the reader list of what it read for the life of the page, so the work
// a write does grows with every row ever dropped, and nothing on the page shows it. An adoption's
// mirror is the same leak with an effect on it, gated in `reactive.test.ts`. THE REVERT: drop the
// `owned(() => orphan(cell))` in `createReactive` — the write visits 4 dead values (two a row)
// where 0 are due.
test('a row that leaves releases the values its <script> derived — 12.14', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let rows = reactive(['one', 'two'])
let level = reactive(0)
</script>

<ul>{#for row of rows by row}<script>
const plus = reactive(() => level + 1)
const twice = reactive(() => level * 2)
</script><li>{row} {plus} {twice}</li>{/for}</ul>
<button id="drop" onclick={() => { rows = [] }}>drop</button>
<button id="bump" onclick={() => { level = level + 1 }}>bump</button>`)
    flushSync()
    expect(document.querySelectorAll('li')).toHaveLength(2)
    click('#drop')
    expect(document.querySelectorAll('li')).toHaveLength(0)

    const work = measure(() => {
        click('#bump')
    })
    expect({ descents: work.descents, wakes: work.wakes }).toEqual({
        descents: 0,
        wakes: 0,
    })
})

// AND A VALUE THAT ESCAPED ITS OWNER IS NEVER LEFT STALE. One a reader outside its owner still
// follows stays wired until that reader leaves; one read after it was released runs its body
// again. The follower is opened from a click, which no setup owns. THE REVERT: release an orphan
// whatever still reads it (drop the reader test from `orphan`) — the follower reads 1 where 2 is
// due.
test('a derived value its owner left behind is current, followed or read — 12.14', async () => {
    await mountPage(`<script>
import { reactive, watch } from '@abide/abide'

let on = reactive(true)
let level = reactive(0)
const seen = ((globalThis as { escaped?: Record<string, unknown> }).escaped = {})
function follow() {
    seen.stop = watch(() => {
        seen.last = (seen.take as () => unknown)()
    })
}
</script>

{#if on}<script>
const plus = reactive(() => level + 1)
seen.take = () => plus
</script><b>{plus}</b>{/if}
<button id="follow" onclick={follow}>follow</button>
<button id="close" onclick={() => { on = false }}>close</button>
<button id="bump" onclick={() => { level = level + 1 }}>bump</button>`)
    flushSync()
    const seen = (globalThis as { escaped?: Record<string, unknown> })
        .escaped as {
        last: unknown
        take: () => unknown
        stop: () => void
    }
    click('#follow')
    expect(seen.last).toBe(1)
    click('#close')
    click('#bump')
    expect(seen.last).toBe(2)

    seen.stop()
    click('#bump')
    expect(seen.take()).toBe(3)
})

// 41.6 — A COMPONENT WITH NOTHING LIVE STILL RUNS ITS `<script>` ON HYDRATION, and 12.4 — what
// that script opened is stopped with it. A static page was "no module" at all, so a watch there
// never ran in the browser. THE REVERT: drop `&& setup.body === ''` from `emitClient`'s
// nothing-live check — the browser's instance is never made, so the one found is the server's,
// which the stop disposes 0 times where 1 is due.
test('a component with nothing live runs its <script>, and stops what it opened — 41.6, 12.4', async () => {
    const { scope } = await mountPage(`<script>
import { reactive, watch } from '@abide/abide'

let mark = reactive('')
;(globalThis as { bumpStatic?: (to: string) => void }).bumpStatic = (to) => {
    mark = to
}
${COUNTED.replace('NAME', "'static'")}
</script>

<p>static</p>`)
    flushSync()
    const page = lastInstance('static')
    expect(page.runs).toBe(1)

    scope.stop()
    expect(page.disposed).toBe(1)
    ;(globalThis as { bumpStatic?: (to: string) => void }).bumpStatic?.('!')
    flushSync()
    expect(page).toEqual({ name: 'static', runs: 1, disposed: 1 })
})

// A TOGGLE DOES NOT ACCUMULATE. The block holds ONE scope for its whole life and REFILLS it on
// each swap, so what the region above it owns stays one entry however many times the arm changes.
// Owning a fresh scope per swap is correct and unbounded: the page outlives the block, so every
// arm ever mounted stays reachable from it.
//
// THE WORK COUNTERS CANNOT SEE THIS — an accumulated scope has already been stopped, so it holds
// no disposer and running it runs nothing. What grows is the ARRAY, so the array is the
// assertion. THE REVERT: `${name}_scope = ${SCOPE}.own(${name}_mount(...))` per swap in
// `emitClient` — `children` is 12 long after eleven flips instead of 1. The arm binds `{on}`
// because an arm that binds nothing opens no scope at all (the test below).
test('an arm that swaps leaves one scope on the region above it — 12.13', async () => {
    const { scope: page } = await mountPage(`<script>
import { reactive } from '@abide/abide'

let on = reactive(true)
</script>

<div>{#if on}<b>{on}</b>{:else}<i>no</i>{/if}</div>
<button id="flip" onclick={() => { on = !on }}>flip</button>`)
    flushSync()
    expect(page.children).toHaveLength(1)
    for (let at = 0; at < 11; at += 1) click('#flip')
    expect(document.querySelector('i')?.textContent).toBe('no')
    expect(page.children).toHaveLength(1)
})

// 14.1 — AN ARM IS BUILT UNTRACKED. The browser fills an arm from inside the watch that chose it,
// and the build evaluates every value it writes — so the `{#if}` below subscribed to `count`, which
// only its arm shows, and every write reran the arm choice as well as the two bindings. The output
// is identical either way; the wake is the whole of the difference, so the wake is what is counted.
// The arm is toggled ON in the browser first: an arm the server painted is hydrated, never built.
//
// THE REVERT: call `build` tracked in `fillRegion` — `wakes` 2 -> 3 on each write of `count`.
test('a value shown only inside an arm does not wake the arm choice — 14.1', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let show = reactive(false)
let count = reactive(0)
</script>

<button id="show" onclick={() => { show = true }}>show</button>
<button id="more" onclick={() => { count = count + 1 }}>more</button>
<div>{#if show}<p id="in" title={count}>{count}</p>{/if}</div>`)
    flushSync()
    click('#show')
    expect(document.querySelector('#in')?.textContent).toBe('0')
    const work = measure(() => click('#more'))
    expect(document.querySelector('#in')?.textContent).toBe('1')
    expect(document.querySelector('#in')?.getAttribute('title')).toBe('1')
    expect(work.bindingRuns).toBe(2)
    expect(work.wakes).toBe(2)
})

// AND A `{#try}`'S CATCH ARM, which its own watch swaps in the same way. The catch below shows
// `count` and the failure alone decides which arm stands, so a write of `count` wakes its two
// bindings and not the boundary.
//
// THE REVERT: call `rgN_swap` tracked in `emitTry` — `wakes` 2 -> 3 on each write of `count`.
test('a value shown only inside a catch arm does not wake the boundary — 14.1', async () => {
    await mountPage(`<script>
import { reactive } from '@abide/abide'

let broken = reactive(false)
let count = reactive(0)

function checked(flag: boolean) {
    if (flag) throw new Error('broken')
    return 'fine'
}
</script>

<button id="break" onclick={() => { broken = true }}>break</button>
<button id="more" onclick={() => { count = count + 1 }}>more</button>
<div>
{#try}
    <b id="body">{checked(broken)}</b>
{:catch problem}
    <p id="in" title={count}>{count}</p>
{/try}
</div>`)
    flushSync()
    click('#break')
    flushSync()
    expect(document.querySelector('#in')?.textContent).toBe('0')
    const work = measure(() => click('#more'))
    expect(document.querySelector('#in')?.textContent).toBe('1')
    expect(document.querySelector('#in')?.getAttribute('title')).toBe('1')
    expect(work.bindingRuns).toBe(2)
    expect(work.wakes).toBe(2)
})

// What a scope tree holds: the scopes in it, a `{#for}`'s rows included, and the disposers on them
// — a `watch` is one disposer, so `stops` is the readers still open.
function held(owner: unknown, into = { scopes: 0, stops: 0 }) {
    const rows = (owner as { rows?: { scope: unknown }[] }).rows
    if (rows !== undefined) for (const row of rows) held(row.scope, into)
    const scope = owner as Scope
    if (!Array.isArray(scope.stops)) return into
    into.scopes += 1
    into.stops += scope.stops.length
    for (const child of scope.children ?? []) held(child, into)
    return into
}

// AN ARM THAT BINDS NOTHING IS ONLY FILLED: there is nothing for a mount to find and nothing for a
// scope to stop, so the block opens neither. A row here holds two `{#if}`s whose arms bind nothing
// — one over the row's own item and one over a `Reactive` — and a `{#for}` whose row binds its
// item. THE REVERT: a block scope and a mount for every `{#if}` whatever its arms hold — 6 scopes
// a row instead of 2, 61 held against 21.
//
// AND `{#if row.stub}` HOLDS NO READER AT ALL: the row's item is typed, `stub` is a plain boolean
// on it, so the subject is proven static (14.2) and the arm is decided once. The reader over
// `selected` and the inner list's stay — one `watch` each a row. THE REVERT: watch every `{#if}`
// whatever its subject — 31 stops against 21.
test('an {#if} whose arms bind nothing opens no scope and no mount — 32.12', async () => {
    const { scope } = await mountPage(`<script>
import { reactive } from '@abide/abide'

const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => ({ id, stub: id % 2 === 0, parts: ['p'] }))
let selected = reactive(1)
</script>

<ul>{#for row of ROWS by row.id}<li>{#if row.stub}<i>stub</i>{/if}{#for part of row.parts}<b>{part}</b>{/for}{#if row.id === selected}<em>on</em>{/if}</li>{/for}</ul>
<button id="pick" onclick={() => { selected = 2 }}>pick</button>`)
    expect(held(scope)).toEqual({ scopes: 21, stops: 21 })
    expect(document.querySelectorAll('i')).toHaveLength(5)
    expect(document.querySelectorAll('b')).toHaveLength(10)
    click('#pick')
    expect(document.querySelector('em')?.parentElement?.textContent).toBe(
        'stubpon',
    )
    expect(document.querySelectorAll('em')).toHaveLength(1)
})

// A ROW THE BROWSER GREW, WITH A REGION INSIDE IT — the case a hydration test cannot reach.
//
// Every nested-region test above MOUNTS AGAINST SERVER MARKUP, so the row's `make` is never
// called: the nodes are already there and the client adopts them. A row the list grows AFTER mount
// takes the other path entirely, and nothing was asserting it.
//
// IT MATTERS MORE SINCE `make` STOPPED PARSING. The markup path inlined the current arm into the
// row's string, so a grown row arrived with its `{#if}` already rendered. Construction emits the
// region as an EMPTY ANCHOR PAIR and leaves the filling to the region's own machinery in `mount` —
// `isEmptyRegion` is true on that first run, so the same `fillRegion` a page-level region uses is
// what puts the arm in. If that hand-off ever breaks, the row appears with its block silently
// missing and every other assertion about it still passes.
//
// NOT A GATE FOR BUILDING OVER PARSING, and worth being exact about: a parsed row satisfies this
// too. It is a correctness test for a path that had none.
//
// IT DOES HAVE TEETH, verified 2026-09-22: dropping the region's CLOSE anchor from `emitBuild`
// fails this with one `abide:hydrate ... a region was due ... (41.10)`, and the build-versus-paint
// table below with it. A row whose region is half written mounts, renders its sibling, and loses
// its block.
test('a row grown in the browser fills the region inside it', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let rows = reactive([{ id: 'a', on: true }])

function add() {
    rows = [...rows, { id: 'b', on: true }]
}
</script>

<ul id="list">{#for row of rows by row.id}<li>{#if row.on}<b>on</b>{/if}<span>{row.id}</span></li>{/for}</ul>
<button id="add" onclick={add}>add</button>`

    await mountPage(source)
    expect(document.querySelectorAll('#list li')).toHaveLength(1)

    const said = await warningsWhile(async () => {
        ;(document.querySelector('#add') as HTMLElement).click()
        flushSync()
    })
    expect(said).toEqual([])

    const rows = [...document.querySelectorAll('#list li')]
    expect(rows).toHaveLength(2)
    // THE GROWN ROW CARRIES BOTH: the arm the region filled, and the sibling standing after it.
    expect(rows[1]?.querySelector('b')?.textContent).toBe('on')
    expect(rows[1]?.querySelector('span')?.textContent).toBe('b')
})

// A RUN IS ONE TEXT NODE IN A ROW THE BROWSER GREW, and the sibling after it is where that is
// proved. `Hello {name}!` is three template nodes and ONE text node in a document — that is what
// setting `innerHTML` produces, and the markup walk places one position for it.
//
// WHY THE ASSERTION IS ON THE `<em>` AND NOT ON THE TEXT. A row that emitted three text nodes
// instead of one renders identically and every assertion about its words passes; what moves is
// every LATER node in the same parent. So the tell is the sibling: `<em>` is child 1 for the
// server and child 3 for a row built one-node-per-template-node, and a binding found one step
// after the run then lands on a text node.
//
// THE REVERT, verified 2026-09-22: place one text position per template node rather than per run
// (`emitChildren`'s run check in `emitComponent`). The build then makes three text nodes where the
// parser makes one, and this reports 3 against the painted row's 1.
test('a run in a grown row is one text node, and the sibling after it is found', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let rows = reactive([{ id: 'a', name: 'Ada' }])

function add() {
    rows = [...rows, { id: 'b', name: 'Grace' }]
}
</script>

<ul id="list">{#for row of rows by row.id}<li><span>Hello {row.name}! <em>one</em></span></li>{/for}</ul>
<button id="add" onclick={add}>add</button>`

    await mountPage(source)
    const painted = document.querySelector('#list li span') as Element
    const paintedRun = [...painted.childNodes].filter(
        (node) => node.nodeType === 3,
    )

    ;(document.querySelector('#add') as HTMLElement).click()
    flushSync()

    const grown = document.querySelectorAll('#list li span')[1] as Element
    const grownRun = [...grown.childNodes].filter((node) => node.nodeType === 3)

    // THE SHAPES MATCH, which is the whole assertion: the row the server painted and the row the
    // browser built are the same document, not two documents that look alike.
    expect(grownRun.length).toBe(paintedRun.length)
    expect(grown.childNodes.length).toBe(painted.childNodes.length)
    expect((grown.childNodes[1] as Element).textContent).toBe('one')
    expect(grown.textContent).toBe('Hello Grace! one')
})

// THE SHAPES A ROW CAN TAKE, BUILT AND PAINTED, COMPARED — the gate for the direction the adopt
// gate cannot see.
//
// `corpusRuns.test.ts` checks that a row the SERVER painted can be adopted by the client's
// addressing. Nothing checked the other direction: that a row the BROWSER built is the same
// document the server would have written. The build and the markup now read ONE description —
// the positions the markup walk places, and the attributes `classifyAttributes` lists — but what
// each writes is still two spellings of one answer (a `createTextNode` against bytes the parser
// reads), and their agreement is a property nothing else enforces.
//
// IT HAS ALREADY BEEN WRONG ONCE. Construction emitted one text node per TEMPLATE node where the
// parser produces one per RUN, so `Hello {name}!` was three nodes built and one painted. Every row
// rendered correctly and every assertion about its words passed; what moved was every later index
// in the same parent. This table is what would have caught it on the first shape.
//
// A SHAPE IS ADDED HERE WHEN A ROW LEARNS TO CARRY SOMETHING NEW — that is the ratchet, and the
// cost of forgetting is a silent off-by-N in a walk nobody reads.
//
// VERIFIED BY REVERT, 2026-09-22: emitting one text node per TEMPLATE node rather than per RUN
// fails this on `text around a slot` and on `a run then a sibling`, reporting
// `span(#text,#text,#text)` against the painted `span(#text)`.
//
// AND THE VALUES, SINCE EVERY ROW IS BUILT. A row used to be built only when it read nothing but
// its item, and the build wrote the author's bytes where the parser decodes them — `AT&amp;T` on
// the page for a grown row, `AT&T` for a painted one — which a comparison of node KINDS cannot
// see. So each node's text and attributes are compared as well; the two rows carry the same data,
// so any difference is the build disagreeing with the server.
const ROW_SHAPES: [string, string][] = [
    ['a bare element', '<li>{row.name}</li>'],
    ['text around a slot', '<li>Hello {row.name}!</li>'],
    [
        'a run then a sibling',
        '<li><span>Hi {row.name}</span><em>after</em></li>',
    ],
    ['nested elements', '<li><span><b>{row.name}</b></span></li>'],
    ['a static attribute', '<li class="row"><span>{row.name}</span></li>'],
    [
        'a computed attribute',
        '<li title={row.name}><span>{row.name}</span></li>',
    ],
    ['an empty element beside a run', '<li><i></i>{row.name}</li>'],
    [
        'a region inside the row',
        '<li>{#if row.on}<b>on</b>{/if}<span>{row.name}</span></li>',
    ],
    // What the row's MOUNT writes, which the build leaves to it.
    ['an attribute reading page state', '<li data-mark={mark}>{row.name}</li>'],
    ['a run reading page state', '<li>{row.name} {mark}</li>'],
    ['a blank run reading page state', '<li><b>x</b>{mark}</li>'],
    // What the parser decodes and the build has to hand over decoded.
    [
        'entities in text and an attribute',
        '<li title="AT&amp;T">AT&amp;T &copy; {row.name}</li>',
    ],
    [
        'an entity in a URL attribute',
        '<li><a href="/x?a=1&amp;b=2">{row.name}</a></li>',
    ],
    // What the server writes nothing for.
    ['a blank run that is empty', '<li>{row.none}<b>x</b></li>'],
    // A merged `class` and `style`, one of them reading page state.
    [
        'merged class and style',
        '<li class="row" class:on={row.on} style="color: red" style:width={row.width}>{row.name}</li>',
    ],
    [
        'a class reading page state',
        '<li class:marked={mark === "m"}>{row.name}</li>',
    ],
    // Several top-level nodes, so the row carries its own anchor.
    ['several top-level nodes', '<dt>{row.name}</dt><dd>{mark}</dd>'],
    // Content only the parser makes right, which keeps the parser.
    [
        'an svg in the row',
        '<li><svg><circle r="1"></circle></svg>{row.name}</li>',
    ],
]

// THE NODE TREE, NOT THE MARKUP. `innerHTML` SERIALIZES — three adjacent text nodes come back as
// one string, identical to the merged node they should have been. The first version of this gate
// compared `innerHTML`, passed against the very revert that motivated it, and was a green test
// measuring nothing: comparing the OUTPUT is exactly what a structural contract cannot be checked
// with. Node kinds and boundaries are what a walk steps over, so they are compared — and each
// node's own text and attributes beside them, in the order the element holds them.
function shapeOf(node: Node | undefined): string {
    if (node === undefined) return '(missing)'
    if (node.nodeType === 3)
        return `#text${JSON.stringify((node as Text).data)}`
    // 41.24 — AN OPEN THE SERVER WROTE NAMES ITS ARM and one the browser wrote does not; what the
    // two must agree on is that it is an open, at this position.
    if (node.nodeType === 8)
        return `#comment(${(node as Comment).data.replace(/^\[\d+$/, '[')})`
    const element = node as Element
    const attributes = [...element.attributes]
        .map(
            (attribute) =>
                `${attribute.name}=${JSON.stringify(attribute.value)}`,
        )
        .join(' ')
    const children = [...node.childNodes].map(shapeOf).join(',')
    // THE NAMESPACE TOO: an `<svg>` built with `createElement` has the same `localName` as the one
    // the parser made, and is an HTML element that draws nothing.
    const space =
        element.namespaceURI === 'http://www.w3.org/1999/xhtml'
            ? ''
            : `${element.namespaceURI}:`
    return `${space}${element.localName}${attributes === '' ? '' : `[${attributes}]`}(${children})`
}

// The list's rows, as the reconcile holds them: each element between the region's anchors, or —
// where a row carries its own anchor — each run of nodes from one anchor to the next.
function rowsOf(list: Element): string[] {
    const nodes = [...list.childNodes].slice(1, -1)
    const anchored = nodes[0]?.nodeType === 8
    if (!anchored) return nodes.map(shapeOf)
    const rows: string[] = []
    for (const node of nodes)
        if (node.nodeType === 8) rows.push(shapeOf(node))
        else rows[rows.length - 1] += `,${shapeOf(node)}`
    return rows
}

test('a row the browser builds is the document the server would have written', async () => {
    const differed: string[] = []
    for (const [what, body] of ROW_SHAPES) {
        const source = `<script>
import { reactive } from '@abide/abide'

let mark = reactive('m')
let rows = reactive([{ id: 'a', name: 'Ada', on: true, none: '', width: '10px' }])

function add() {
    rows = [...rows, { id: 'b', name: 'Ada', on: true, none: '', width: '10px' }]
}
</script>

<ul id="list">{#for row of rows by row.id}${body}{/for}</ul>
<button id="add" onclick={add}>add</button>`

        await mountPage(source)
        ;(document.querySelector('#add') as HTMLElement).click()
        flushSync()

        // THE TWO ROWS CARRY THE SAME DATA, so the only difference a comparison can find is the
        // BUILD — which is the whole question. Every field is equal in both for exactly this.
        const [painted, grown] = rowsOf(
            document.querySelector('#list') as Element,
        )
        if (painted !== grown)
            differed.push(
                `${what}\n      painted ${painted}\n      grown   ${grown}`,
            )
    }
    expect(differed).toEqual([])
})

// THE SAME GATE FOR AN ARM. A `{#if}` arm the server painted is hydrated; one the browser swaps in
// INSIDE A ROW is BUILT from the arm's positions — the same build a row takes, since an arm in a
// row is made once a row (`Cursor.repeated`) — so the two are held against each other the way a
// grown row is against a painted one: painted on load, then swapped out and back, which builds
// it, and the region compared node for node. An arm standing on a page is made once a swap and
// is parsed, which is why this one stands in a row of one.
//
// A RAW VALUE IS HERE because an arm is where the docs app writes one (`DocsNav`'s
// `{raw(item.nav)}`): the server parses it into elements, and a build that wrote it as text would
// put markup on the screen.
//
// THE REVERT, verified 2026-09-22: make the `isRaw` test false in `builtRun`, so every run is
// written as text, and this reports `a raw value` alone — an element painted, its markup as text
// grown. Dropping the `&` decoding or building parser-owned content reports the same way.
const ARM_SHAPES: [string, string][] = [
    ['text and an element', '<p>Hello <b>{name}</b>!</p>'],
    ['entities', '<p title="AT&amp;T">AT&amp;T &copy;</p>'],
    ['an attribute reading page state', '<p data-name={name}>x</p>'],
    ['a run reading page state', '<p>{name} and more</p>'],
    ['a blank run that is empty', '<p>{none}<b>x</b></p>'],
    ['a raw value', '<p>{raw(html)}</p>'],
    [
        'merged class and style',
        '<p class="a" class:on={name === "Ada"} style:width={width}>x</p>',
    ],
    [
        'a region inside the arm',
        '<p>{#if name}<i>in</i>{/if}<span>after</span></p>',
    ],
    ['several top-level nodes', '<dt>{name}</dt><dd>x</dd>'],
    ['an svg in the arm', '<svg><circle r="1"></circle></svg>'],
]

test('an arm the browser builds is the document the server would have written', async () => {
    const differed: string[] = []
    for (const [what, arm] of ARM_SHAPES) {
        const source = `<script>
import { reactive, raw } from '@abide/abide'

let on = reactive(true)
let name = reactive('Ada')
const none = ''
const width = '10px'
const html = '<b>hi</b>'
</script>

{#for one of [1]}<div id="host">{#if on}${arm}{/if}</div>{/for}
<button id="flip" onclick={() => { on = !on }}>flip</button>`

        await mountPage(source)
        const host = document.querySelector('#host') as Element
        const painted = [...host.childNodes].map(shapeOf).join(',')
        click('#flip')
        click('#flip')
        const grown = [...host.childNodes].map(shapeOf).join(',')
        if (painted !== grown)
            differed.push(
                `${what}\n      painted ${painted}\n      grown   ${grown}`,
            )
    }
    expect(differed).toEqual([])
})

// A REGION AT A ROW'S TOP LEVEL FILLS LATER THAN THE ROW IS MADE. A row the browser builds is its
// anchor, an empty `{#if}` pair and its `<span>` — the arm's `<b>` goes between the pair on the
// row's MOUNT, after `make` handed its nodes over. A row held as the array `make` returned never
// learned about the `<b>`, so the reconcile moved the row's other nodes and left the `<b>` behind
// after whichever row came to stand there. A row the SERVER painted hid it: hydration collected
// the arm as it stood, so the case needs a row the list GREW.
//
// THE ROW IS ITS SIBLINGS, from its anchor to the next row's anchor or the region's close — the
// way a region is its open/close pair — so whatever fills inside it later is in it.
//
// THE REVERT: move and remove a multi-root row by the nodes `make` returned rather than by the
// range from its anchor. The swap leaves row b's `<b>` after row a, and this reports
// `r,[,],span(b),r,[,b(a),],span(a),b(b),]`-shaped rows rather than each row whole.
const STRANDED = `<script>
import { reactive } from '@abide/abide'

let mark = reactive('')
let rows = reactive([{ id: 'a', on: true }])

function next() {
    rows = (globalThis as { __ROWS__?: { id: string; on: boolean }[] }).__ROWS__ ?? []
}
</script>

<ul id="list">{#for row of rows by row.id}{#if row.on}<b>{row.id}{mark}</b>{/if}<span>{row.id}</span>{/for}</ul>
<button id="next" onclick={next}>next</button>`

// The list's children as one line: an anchor by its data, an element by its tag and its text.
function flatOf(list: Element): string {
    const parts: string[] = []
    for (const node of list.childNodes)
        parts.push(
            node.nodeType === 8
                ? (node as Comment).data
                : node.nodeType === 3
                  ? `#${JSON.stringify((node as Text).data)}`
                  : `${node.nodeName.toLowerCase()}(${node.textContent})`,
        )
    return parts.join(',')
}

// What the list is due to read for these rows: the region's pair around each row whole.
function flatDue(rows: { id: string; on: boolean }[]): string {
    const parts = ['[']
    for (const row of rows) {
        parts.push('r', '[')
        if (row.on) parts.push(`b(${row.id})`)
        parts.push(']', `span(${row.id})`)
    }
    parts.push(']')
    return parts.join(',')
}

// ONE OBJECT PER KEY FOR THE LIFE OF A TEST, so a row that survives keeps its identity and is
// MOVED rather than remade — a remade row has fresh nodes and would hide what a move left behind.
function stepTo(
    known: Map<string, { id: string; on: boolean }>,
    ids: string[],
): { id: string; on: boolean }[] {
    const rows: { id: string; on: boolean }[] = []
    for (const id of ids) {
        let row = known.get(id)
        if (row === undefined) {
            // Every third key has its arm closed, so an empty pair moves too.
            row = { id, on: id.charCodeAt(id.length - 1) % 3 !== 0 }
            known.set(id, row)
        }
        rows.push(row)
    }
    ;(globalThis as { __ROWS__?: unknown }).__ROWS__ = rows
    click('#next')
    return rows
}

test('a region filled inside a grown row moves with the row', async () => {
    await mountPage(STRANDED)
    const list = document.querySelector('#list') as Element
    const known = new Map([['a', { id: 'a', on: true }]])
    // The page's own item is a different object from the one above, so `a` is remade here too —
    // both rows are the browser's from this step on.
    stepTo(known, ['a', 'b'])
    const grown = stepTo(known, ['a', 'b'])
    expect(flatOf(list)).toBe(flatDue(grown))
    let swapped: { id: string; on: boolean }[] = []
    const work = measure(() => {
        swapped = stepTo(known, ['b', 'a'])
    })
    expect(flatOf(list)).toBe(flatDue(swapped))
    // ONE ROW MOVES, and all of it: its anchor, the arm's pair and the `<b>` between them, and its
    // `<span>`. Moved as the array `make` returned, it was 1 element — the `<b>` stayed behind.
    expect(`elements ${work.elementsMoved}, markers ${work.markersMoved}`).toBe(
        'elements 2, markers 3',
    )
})

// THE FULL REVERSE, which prices nothing and is the case that catches a transposition the two-row
// swap reports clean: every row moves, and each has to arrive whole and in order.
test('a full reverse of grown multi-root rows keeps every row whole', async () => {
    await mountPage(STRANDED)
    const list = document.querySelector('#list') as Element
    const known = new Map<string, { id: string; on: boolean }>()
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    stepTo(known, ids)
    const reversed = stepTo(known, [...ids].reverse())
    expect(flatOf(list)).toBe(flatDue(reversed))
})

// A FUZZ WHOSE STEPS CHANGE SEVERAL THINGS AT ONCE — rows leave, rows arrive and the rest are
// permuted, in one write. One change per step cannot reach a guard derived from a SUMMARY of the
// change, because the summary and the truth agree by construction there, and the WHOLE list is
// compared after every step rather than its ends.
test('a random multi-step reorder of multi-root rows keeps every row whole', async () => {
    await mountPage(STRANDED)
    const list = document.querySelector('#list') as Element
    const known = new Map<string, { id: string; on: boolean }>()
    // mulberry32 over a fixed seed, so a failure is the same failure on the next run. An LCG's
    // low bits cycle every few draws, and `% 4` over them never added a row.
    let seed = 0x2f6e2b1
    const random = (below: number): number => {
        seed = (seed + 0x6d2b79f5) | 0
        let mixed = Math.imul(seed ^ (seed >>> 15), seed | 1)
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
        return ((mixed ^ (mixed >>> 14)) >>> 0) % below
    }
    let ids: string[] = []
    let fresh = 0
    for (let step = 0; step < 60; step += 1) {
        const next: string[] = []
        for (const id of ids) if (random(4) !== 0) next.push(id)
        const arriving = random(4)
        for (let at = 0; at < arriving; at += 1) {
            next.splice(random(next.length + 1), 0, `k${fresh}`)
            fresh += 1
        }
        for (let at = next.length - 1; at > 0; at -= 1) {
            const other = random(at + 1)
            const held = next[at] as string
            next[at] = next[other] as string
            next[other] = held
        }
        ids = next
        const rows = stepTo(known, ids)
        expect(`${step}: ${flatOf(list)}`).toBe(`${step}: ${flatDue(rows)}`)
    }
})

// A ROW ANCHOR ONE REGION DOWN IS NOT A ROW OF THIS LIST. A multi-root `{#for}` inside an arm at a
// multi-root row's top level writes `r` anchors of its own between the arm's pair, and hydration
// counts this list's rows by the anchors at the list's own DEPTH. Counted at any depth, two rows
// of two inner items read as six, and hydration wired items to rows that were not rows.
//
// THE REVERT: count every `ROW_OPEN` in `rowsIn`, whatever its depth. The mount throws
// `undefined is not an object (evaluating 'row.id')` — the key read for a third item that is not
// there.
test('a nested list’s row anchors are not the outer list’s rows', async () => {
    const said = await warningsWhile(async () => {
        await mountPage(`<script>
import { reactive } from '@abide/abide'

let mark = reactive('')
let rows = reactive([
    { id: 'a', xs: ['1', '2'] },
    { id: 'b', xs: ['3', '4'] },
])

function swap() {
    const [first, second] = rows
    rows = [second, first]
}
</script>

<ul id="list">{#for row of rows by row.id}{#if row.id}{#for x of row.xs}<i>{x}{mark}</i><u>{x}</u>{/for}{/if}<span>{row.id}</span>{/for}</ul>
<button id="swap" onclick={swap}>swap</button>`)
    })
    expect(said).toEqual([])
    const list = document.querySelector('#list') as Element
    const before = [...list.querySelectorAll('span')]
    click('#swap')
    expect(list.textContent).toBe('3344b1122a')
    // Kept, not rebuilt.
    expect([...list.querySelectorAll('span')]).toEqual([
        before[1] as HTMLSpanElement,
        before[0] as HTMLSpanElement,
    ])
})

// 12.13, 41.10 — AN ARM THAT REFUSES ITS DOCUMENT REBUILDS ITS BINDINGS AND KEEPS ITS `<script>`'S
// WATCHES. The script ran once, into the arm's scope, ahead of the mount; the rebuild reruns the
// mount and not the script, so the refusal stops only what the mount opened. THE REVERT: stop the
// whole scope on a refusal (`stop()` for `stop(__mark)` in `mountFunction`) — the script's watch is
// disposed at the rebuild and wakes 0 times at the bump where once is due.
test('an arm rebuilt by a mismatch keeps the watch its <script> opened — 12.13, 41.10', async () => {
    const source = `<script>
import { reactive, watch } from '@abide/abide'

let mark = reactive('')
let on = reactive(true)
</script>

{#if on}<script>
${COUNTED.replace('NAME', "'rebuilt'")}
</script><p id="armp">arm {mark}</p>{/if}
<button id="bump" onclick={() => { mark = '!' }}>bump</button>`
    const { mount } = await renderPage(source)
    ;(document.querySelector('#armp') as HTMLElement).replaceWith(
        document.createElement('b'),
    )
    const said = await warningsWhile(async () => {
        mount()
    })
    expect(said.filter((line) => line.includes('41.10'))).toHaveLength(1)
    const arm = lastInstance('rebuilt')
    expect(arm).toEqual({ name: 'rebuilt', runs: 1, disposed: 0 })
    click('#bump')
    expect(document.querySelector('#armp')?.textContent).toBe('arm !')
    expect(arm).toEqual({ name: 'rebuilt', runs: 2, disposed: 1 })
})
