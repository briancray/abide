// A REGION INSIDE A REGION, AND A RUN THAT RENDERED NOTHING. Both are the same mechanism — how a
// path is addressed against a document somebody already rendered — and both were unreachable
// ground: every corpus example is nesting-depth 1 and no fixture nested one, so `{#if}` inside an
// arm, `{#for}` inside an arm, either inside a ROW, and a sibling after any of them all took the
// page's whole hydration down with `region 0 is not in the rendered document`.
//
// WHAT THEY HAVE IN COMMON is that the root a path starts from is not always a NODE: the page's is,
// an arm's is its own anchor pair, and a row's is the array the reconcile handed back. One walk
// takes all three, and a REGION REFERENCE — `-1 - n`, region n directly inside whatever the walk
// has reached — is decoded wherever it stands rather than only at a path's head.
//
// A BLANK RUN is the other half: every part of it is an expression, so a value that stringifies to
// `''` writes NO node and every index after it in that parent is short by one. The compiler says
// which runs those are and `textAt` puts the node back at the position it belongs, which is what
// makes the count the rest of the page assumes true.

import { afterAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { compileFile, emitClient, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync } from '#shared'
import { textAt } from '#ui/nodeAt.ts'
import type { Scope } from '#ui/Scope.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'
import { clientOf, closeTyped } from './typed.ts'

afterAll(closeTyped)

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)
afterAll(() => {
    session.close()
    removeTemporaryModules()
})

// THE SCOPE THE LAST `mountPage` OPENED. A gate about what a region still HOLDS cannot be read
// from the work counters — an accumulated scope that was already stopped runs nothing — so the
// page's own scope is the only place that fact is visible.
let mounted: Scope | undefined

async function mountPage(source: string): Promise<string> {
    const file = parseAbide(source)
    const names = await session.reads(`${ROOT}src/page.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(source, names),
        'Page.client.ts': emitClient(file, names) || 'export default () => {}',
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
    mounted = mount(document.body) as Scope
    return html
}

const click = (id: string): void => {
    ;(document.querySelector(id) as HTMLElement).click()
    flushSync()
}

// Everything `console.warn` was told while the body ran. 41.11's warning is the only thing the
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

// A NESTED REGION IS ADDRESSED AGAINST THE ARM THAT HOLDS IT, not against the arm's first child.
// An empty path means the root ITSELF, and the root of an arm is its anchor pair.
//
// THE REVERT: resolve an empty path as the root's first CHILD in `emitClient`'s `step`
// (`childAt(rg0, [0])`), which is what it did. The inner region is then looked for inside the
// `<p>`, and this reports TWO `abide:hydrate abide: region 0 is not in the rendered document
// ... (41.11)` warnings where none is due — one from the block, one from the rebuild that fails
// the same way — with `#deep` dead behind them.
test('an {#if} inside an arm is found, and its binding is live', async () => {
    const source = `<script>
import { reactive } from 'abide'

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

    // Region 0 of the ARM, which is the arm itself and not a node inside it.
    const client = await clientOf(source, ['outer', 'inner', 'name'])
    expect(client).toContain('__regionAt(rg0, 0)')
})

// THE SAME PROPERTY FROM A ROW, whose root is an ARRAY rather than an anchor pair — and a sibling
// AFTER the nested region, which is the pair `[-1, 0]` resolved against that array.
//
// THE REVERT: the same one. The region is then looked for inside the row's own opening anchor —
// a comment with no children — and this reports two `abide:hydrate abide: region 0 is not in the
// rendered document ... (41.11)` warnings where none is due, with neither row wired.
test('an {#if} inside a {#for} row is found, and so is the sibling after it', async () => {
    const source = `<script>
import { reactive } from 'abide'

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

// A RUN AFTER A NESTED REGION, inside the arm that holds both. The reference is `[-1, 0]` against
// the ARM, so the base it counts regions in is the arm's anchor pair — and reading that base as a
// node is the crash the walk used to take.
//
// THE REVERT: drop the `Region` branch from `regionAt`'s scan, so an arm's anchor pair is read as
// a node. `root.firstChild` on a record that has none is `undefined`, `undefined !== null` holds,
// and this reports a thrown `TypeError: undefined is not an object (evaluating 'node.nodeType')`
// out of mount — NOT a `Mismatch`, so nothing swallows it — where `xy1` is due.
test('a run after a nested region is bound against the arm', async () => {
    const source = `<script>
import { reactive } from 'abide'

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

// A REGION REFERENCE IN THE MIDDLE OF A PATH. `place()` writes one wherever a sibling follows a
// region, so a region three elements deep is addressed `[0, -1, 0, 0]` — and a walk that only
// decodes a negative at index 0 reads the rest as `childNodes[-1]`.
//
// THE REVERT: decode a negative only at `at === 0` in `nodeAt`'s walk, which is where the emitter
// used to put one. The rest is read as `childNodes[-1]` and this reports one
// `abide:hydrate abide: no node at [0,-1,0,0] ... (41.11)` where none is due, `#tail` unwired.
test('a region reference is decoded wherever it stands in a path', async () => {
    const source = `<script>
import { reactive } from 'abide'

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

    // The pair is in the PATH, not spelled out by the emitter: `-1` is region 0 of what the walk
    // has reached and the `0` after it counts nodes past its closing anchor.
    const client = await clientOf(source, ['open', 'count'])
    expect(client).toContain('[0,-1,0,0]')
})

// A BLANK RUN RENDERS NO NODE, and the sibling after it then stands where the run was. The server
// wrote `<p><b>x</b></p>` for a page whose author wrote `<p>{msg}<b>x</b></p>`, so `[0,0]` is the
// `<b>` — and the binding has nowhere to write.
//
// THE REVERT: emit `textAt` without the `blank` argument, so a node of the wrong kind is refused
// rather than a missing one inserted. This reports one `abide:hydrate abide: [0,0] is a B where
// this binding's text was rendered ... (41.11)` where none is due, and `<p>` holding one child
// where two are.
test('a blank run gets its node back, at the position it belongs', async () => {
    const source = `<script>
import { reactive } from 'abide'

let msg = reactive('')
</script>

<p id="out">{msg}<b>x</b></p>`

    const said = await warningsWhile(async () => {
        const html = await mountPage(source)
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
// THE REVERT: put the append-at-end fallback back in `textAt` — `insertText(holder, null)` rather
// than before the node the path asked for. `#out` then reads `x00` where `x0` is due: the trailing
// run finds the node the blank one made at the end of the parent and writes into it.
test('a blank run does not steal the node of the run after it', async () => {
    const source = `<script>
import { reactive } from 'abide'

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
// `abide:hydrate abide: no node at [1] ... (41.11)` where none is due, `#one` and `#two` unwired.
test('an anchor past a blank run is walked after the run is filled', async () => {
    const source = `<script>
import { reactive } from 'abide'

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
// THE REVERT: skip a run with no live binding in `emitRegion` (`if (!bound) continue`), which is
// what the filter did. The `<b>` is then at `[0,0]` where the plan says `[0,1]`, and this reports
// one `abide:hydrate abide: no node at [0,1,0] ... (41.11)` where none is due.
test('a static blank run is addressed even though it is never bound', async () => {
    const source = `<script>
import { reactive } from 'abide'

const nothing = ''
let a = reactive('A')
</script>

<p id="out">{nothing}<b id="in">{a}</b></p>`

    const said = await warningsWhile(async () => {
        await mountPage(source)
    })
    expect(said).toEqual([])
    expect((document.querySelector('#in') as HTMLElement).textContent).toBe('A')

    // Addressed, and NOT bound: no `setText` around it and no second watch.
    const client = await clientOf(source, ['a'])
    expect(client).toContain('__textAt(root, [0,0], true)')
    expect(client.match(/watch(Effect)?\(/g) ?? []).toHaveLength(1)
})

// 41.11 — A MISMATCH REBUILDS THE ENCLOSING BLOCK AND WARNS, and rebuilds NOTHING WIDER. The
// document is corrupted between the render and the mount, which is what a real mismatch is: the
// client's plan and the served nodes disagree, and the clause says the block re-renders rather
// than the page throwing.
//
// THE REVERT: drop the `try`/`catch` from the emitted `rgN_mount` in `emitBlock`. The mismatch then
// reaches the page's own catch, which 41.11 forbids rebuilding, and this reports `#body` NULL
// where the re-rendered `<p>` is due — one block's failure taking the block away for good.
test('a mismatch inside a block rebuilds the block and warns', async () => {
    const source = `<script>
import { reactive } from 'abide'

let open = reactive(true)
let name = reactive('ada')
</script>

{#if open}<p id="body">hello {name}</p>{/if}
<footer id="foot">{name}</footer>
<button id="rename" onclick={() => name = name + '!'}>rename</button>`

    const file = parseAbide(source)
    const names = await session.reads(`${ROOT}src/page.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(source, names),
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

    // The corruption: the arm's own node, replaced by one of a shape the plan does not describe.
    // Everything outside the region is untouched.
    const wrong = document.createElement('b')
    ;(document.querySelector('#body') as HTMLElement).replaceWith(wrong)

    const { default: mount } = await import(`${dir}/Page.client.ts`)
    const said = await warningsWhile(async () => {
        mount(document.body)
    })

    expect(said).toHaveLength(1)
    expect(said[0]).toContain('abide:hydrate')
    expect(said[0]).toContain('41.11')

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

// AN AUTHOR'S OWN THROW IS NOT A MISMATCH and comes straight back out. The catch 41.11 asks for is
// a brand test, not a blanket one — a page that swallows every throw at mount is a page whose
// first bug is invisible.
//
// THE REVERT: drop the `instanceof Mismatch` test in `warnMismatch` so every throw reads as one.
// This reports the thrown message as `""` where `boom` is due — an author's first bug, swallowed
// by the catch written for a mismatch.
test('a throw that is not a mismatch is not swallowed', async () => {
    const source = `<script>
import { reactive } from 'abide'

let count = reactive(0)
const boom = (): string => {
    throw new Error('boom')
}
</script>

<p id="out">{boom()}{count}</p>`

    const file = parseAbide(source)
    const names = await session.reads(`${ROOT}src/page.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(source, names),
        'Page.client.ts': emitClient(file, names),
    })
    document.body.innerHTML = '<p id="out">0</p>'
    const { default: mount } = await import(`${dir}/Page.client.ts`)

    let thrown = ''
    const said = await warningsWhile(async () => {
        try {
            mount(document.body)
        } catch (error) {
            thrown = (error as Error).message
        }
    })
    expect(thrown).toBe('boom')
    expect(said).toEqual([])
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
import { reactive } from 'abide'

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

// A BLANK RUN AT A ROW'S OWN TOP LEVEL. A row IS its nodes — the reconcile moves and removes
// exactly what that array holds — so a node put into the document has to go into the ARRAY at the
// same index, or the row leaves part of itself behind on the first reorder.
//
// THE REVERT: drop the `holder.splice(last, 0, text)` in `textAt`. The array is then one node
// short of the document for the rest of the row's walk, and this reports TWO
// `abide:hydrate abide: no node at [2,0] ... (41.11)` warnings — one a row — where none is due.
test('a blank run inside a row goes into the row’s nodes as well', async () => {
    const source = `<script>
import { reactive } from 'abide'

let rows = reactive([
    { id: 'a', tag: '' },
    { id: 'b', tag: '' },
])

function swap() {
    const [first, second] = rows
    rows = [second, first]
}
</script>

<ul id="list">{#for row of rows by row.id}{row.tag}<span>{row.id}</span>{/for}</ul>
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
})

// 41.11 IN A ROW. The block that rebuilds is the ROW, and nothing outside it is touched — which is
// what `replaceNodes` is for: the fresh nodes go in where the old ones were AND into the array the
// reconcile holds, so the row is still one row afterwards.
//
// The row's run carries a STATIC piece on purpose — a blank run is one `textAt` fills rather than
// refuses — and reads a page-level reactive, because a slot reading only the loop ITEM is written
// by the markup and never bound at all.
//
// THE REVERT: drop the `try`/`catch` from the emitted `lsN_mount` in `emitList`. The mismatch
// reaches the page's own catch, and this reports `document.querySelector('#list b')` non-null —
// the corrupted node still in the list — where the rebuilt `<li>id p-b</li>` is due.
test('a mismatch inside a row rebuilds the row and warns', async () => {
    const source = `<script>
import { reactive } from 'abide'

let rows = reactive([{ id: 'a' }, { id: 'b' }])
let prefix = reactive('p')
</script>

<ul id="list">{#for row of rows by row.id}<li>id {prefix}-{row.id}</li>{/for}</ul>`

    const file = parseAbide(source)
    const names = await session.reads(`${ROOT}src/page.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(source, names),
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

    // One row's node, replaced by a shape the row's plan does not describe.
    const wrong = document.createElement('b')
    ;(document.querySelectorAll('#list li')[1] as HTMLElement).replaceWith(
        wrong,
    )

    const { default: mount } = await import(`${dir}/Page.client.ts`)
    const said = await warningsWhile(async () => {
        mount(document.body)
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

// A ROW'S NODES ARE THE ROW, and a blank run addressed THROUGH a region inside a row element is
// not one of them: the node goes inside that element, and the row array must not learn about it.
// Spliced against `root` rather than against the `holder` the walk actually reached, the text went
// into the row's top-level array — so the reconcile hoisted it OUT of the element on the first
// reorder (`parent.insertBefore` runs against the list's parent) and deleted it out of the element
// on the row's removal.
//
// THE REVERT: `rowHolds(root, text, found)` in `textAt`'s region branch. This reports the row
// array holding 2 nodes where 1 is due, with the second one parented to the `<div>` inside it.
test('a blank run inside a row element does not join the row', () => {
    document.body.replaceChildren()
    const host = document.createElement('ul')
    host.innerHTML = '<div id="row"><!--[--><!--]--></div>'
    document.body.append(host)
    const row = host.querySelector('#row') as HTMLElement
    const rowNodes: Node[] = [row]

    const text = textAt(rowNodes, [0, -1, 0], true)

    expect(rowNodes).toHaveLength(1)
    expect(text.parentNode).toBe(row)
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
import { reactive } from 'abide'

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
import { reactive } from 'abide'

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

// A TOGGLE DOES NOT ACCUMULATE. The block holds ONE scope for its whole life and REFILLS it on
// each swap, so what the region above it owns stays one entry however many times the arm changes.
// Owning a fresh scope per swap is correct and unbounded: the page outlives the block, so every
// arm ever mounted stays reachable from it.
//
// THE WORK COUNTERS CANNOT SEE THIS — an accumulated scope has already been stopped, so it holds
// no disposer and running it runs nothing. What grows is the ARRAY, so the array is the
// assertion. THE REVERT: `${name}_scope = ${SCOPE}.own(${name}_mount(...))` per swap in
// `emitClient` — `children` is 12 long after eleven flips instead of 1.
test('an arm that swaps leaves one scope on the region above it — 12.13', async () => {
    await mountPage(`<script>
import { reactive } from 'abide'

let on = reactive(true)
</script>

<div>{#if on}<b>yes</b>{:else}<i>no</i>{/if}</div>
<button id="flip" onclick={() => { on = !on }}>flip</button>`)
    flushSync()
    const page = mounted as Scope
    expect(page.children).toHaveLength(1)
    for (let at = 0; at < 11; at += 1) click('#flip')
    expect(document.querySelector('i')?.textContent).toBe('no')
    expect(page.children).toHaveLength(1)
})
