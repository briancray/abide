// 32.18 AND 33 — A COMPONENT AND ITS PROPS, END TO END. The parent renders the child where it
// stands, the child mounts against the anchors the parent's markup put round it, and a prop is a
// LIVE READ: the parent's value moves and the child re-reads with nobody arranging it.
//
// THE WORK IS THE ASSERTION rather than the text. The arm the `props-live` example ships hands
// the child a reader and then owns telling it when to run — `total.update()` beside every write —
// so a component that re-rendered its whole subtree would print the same string. What a live prop
// buys is one binding run in the child and no node created anywhere, and that is what is counted.

import { afterAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { emitClient, emitComponent, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync } from '#shared'
import { pageRegion } from '#ui/regions.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)

afterAll(() => {
    session.close()
    removeTemporaryModules()
})

const TOTAL = `<script>
import { props } from 'abide'

const { amount, currency = 'USD' } = props<{ amount: number; currency?: string }>()
</script>

<strong>{currency} {amount.toFixed(2)}</strong>`

const PAGE = `<script>
import { reactive } from 'abide'
import Total from './Total.abide'

let lines = reactive(2)
</script>

<ul><li><span>lines</span><strong>{lines}</strong></li><li><Total amount={lines * 620}/></li></ul>
<button onclick={() => { lines = lines + 1 }}>+</button>`

// A page and the components it invokes, compiled together and mounted into the markup the server
// wrote — which is the whole of what a caller and a child have to agree on.
async function mountPage(
    page: string,
    components: Record<string, string> = {},
): Promise<{ html: string; mount: (root: unknown) => void }> {
    const modules: Record<string, string> = {}
    for (const [name, source] of Object.entries({
        ...components,
        Page: page,
    })) {
        const file = parseAbide(source)
        const reads = await session.reads(`${ROOT}src/${name}.abide`, file)
        modules[`${name}.ts`] = emitComponent(file, reads)
        modules[`${name}.client.ts`] =
            emitClient(file, reads, name !== 'Page' ? 'repeated' : 'none') ||
            'export default () => {}'
    }
    const dir = temporaryModule(modules)

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
    return { html, mount }
}

// THE REVERT: emit the invocation as markup, which is what it was until now — the document carries
// a literal `<Total amount="1240">` tag, the child never runs, and `1240.00` is nowhere on the
// page. It is also what makes the anchors worth their bytes: without them the `<button>` after the
// list is addressed by counting through a shape that lives in another file.
test('a component renders where it stands, and its prop is the caller expression — 32.18, 33.5', async () => {
    const { html } = await mountPage(PAGE, { Total: TOTAL })

    expect(html).toContain('<strong>USD 1240.00</strong>')
    expect(html).not.toContain('<Total')
    // The child's markup is one region, anchored: 32.18's pair, and nothing else added.
    expect(html).toContain(
        '<li><!--[--><strong>USD 1240.00</strong><!--]--></li>',
    )
})

// 33.5 — A LIVE READ, NOT A SNAPSHOT, and the counts are how that is told from a re-render. ONE
// binding wakes in the child, and no node is created: the child's own text node, written by the
// server, is the one that moves.
test('a prop re-reads when the caller value moves, and nothing is rebuilt — 33.5', async () => {
    const { mount } = await mountPage(PAGE, { Total: TOTAL })
    mount(pageRegion(document.body))
    flushSync()

    const child = document.querySelector('li:last-child strong') as Element
    const before = child.firstChild
    expect(child.textContent).toBe('USD 1240.00')

    const work = measure(() => {
        ;(document.querySelector('button') as HTMLElement).click()
        flushSync()
    })

    expect(child.textContent).toBe('USD 1860.00')
    // The child re-read without being called again: same element, same text node.
    expect(child.firstChild).toBe(before)
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
    // Two bindings woke — the page's own `{lines}` and the child's run — and nothing else did.
    expect(work.wakes).toBe(2)
})

// 14.7 — A CHILD'S SETUP DOES NOT TRACK, WHEREVER IT IS INVOKED. An arm mounts inside the watch
// that chose it, so a child in an arm whose setup read a prop subscribed the caller's `{#if}` to
// that prop: a write re-ran the arm choice as well as the child's binding. The setup's snapshot
// staying `0` is the same with the fix in or out — the wake is the difference.
//
// THE REVERT: drop the `untracked` round the call in `emitInvocation` — `wakes` 1 -> 2.
test('a child setup in an arm does not wake the arm choice — 14.7', async () => {
    const { mount } = await mountPage(
        `<script>
import { reactive } from 'abide'
import Total from './Total.abide'

let show = reactive(false)
let count = reactive(0)
</script>

<button id="show" onclick={() => { show = true }}>show</button>
<button id="more" onclick={() => { count = count + 1 }}>more</button>
<div>{#if show}<Total amount={count}/>{/if}</div>`,
        {
            Total: `<script>
import { props } from 'abide'

const { amount } = props<{ amount: number }>()
const first = amount * 2
</script>

<strong id="in">{amount} {first}</strong>`,
        },
    )
    mount(pageRegion(document.body))
    flushSync()
    ;(document.querySelector('#show') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#in')?.textContent).toBe('0 0')
    const work = measure(() => {
        ;(document.querySelector('#more') as HTMLElement).click()
        flushSync()
    })
    expect(document.querySelector('#in')?.textContent).toBe('1 0')
    expect(work.wakes).toBe(1)
})

// 33.4 — ONE ACCESSOR PER KEY, so a default is an accessor too: bound as the author wrote it,
// `currency` is a string and every read of it in the child is a call on a string.
test('a default prop is answered where the caller passed none — 33.4', async () => {
    const { html } = await mountPage(
        `<script>
import Total from './Total.abide'
</script>
<Total amount={12} currency="EUR"/><Total amount={7}/>`,
        { Total: TOTAL },
    )
    expect(html).toContain('<strong>EUR 12.00</strong>')
    expect(html).toContain('<strong>USD 7.00</strong>')
})

// 32.18 THROUGH THE BUILD — A CHILD WITH NOTHING TO HYDRATE STILL SHIPS A MODULE, because the
// caller's client module imports one by name. "A static page ships no client" is the rule this is
// the exception to, and the import is what forces it: the child is static, the page is not, and
// the page's `import Static from './Static.client.ts'` has to resolve to something.
//
// AND THE MODULE FILLS, which is why this is not a no-op. The caller writes the anchor pair and
// nothing between it (32.18), so the child's markup is the child's to put there — a row the
// server painted has it already and a row the browser GREW does not. Shipping
// `export default () => {}` here satisfied the import and left every grown row empty, and the
// page looked right because the only rows anybody checked were the server's.
// THE REVERT: return '' from `emitClient` on `!live` (`lines.length === 0`) alone — `Static.client.ts` is the
// no-op again, and the second row below comes out `<!--[--><!--]-->`.
test('an invoked static component still gets a client module — 32.18', async () => {
    const source = temporaryModule({
        'Static.abide': '<strong>nothing moves here</strong>',
        'page.abide': `<script>
import { reactive } from 'abide'
import Static from './Static.abide'

let count = reactive(0)
</script>
<p>{count}</p><Static/>`,
    })
    const out = `${source}/.abide`
    const built = Bun.spawnSync([
        'bun',
        new URL('../bin/abide.ts', import.meta.url).pathname,
        'build',
        '--root',
        source,
        '--out',
        out,
    ])
    expect(built.exitCode).toBe(0)

    const client = await Bun.file(`${out}/Static.client.ts`).text()
    expect(client).not.toBe('export default () => {}\n')
    expect(client).toContain('nothing moves here')
    expect(await Bun.file(`${out}/page.client.ts`).text()).toContain(
        "from './Static.client.ts'",
    )
})

// THE OTHER HALF, in a document: a row the browser grows has to come out the same as a row the
// server painted, and a static child is where the two can differ silently — the caller writes its
// anchors and stops, so nothing but the child's own module can put markup between them.
test('a static child fills the anchors of a row the browser grew — 32.18', async () => {
    const { mount } = await mountPage(
        `<script>
import { reactive } from 'abide'
import Tag from './Tag.abide'

let rows = reactive(['one'])
</script>

<ul>{#for row of rows by row}<li>{row}<Tag/></li>{/for}</ul>
<button id="add" onclick={() => { rows = ['one', 'two'] }}>add</button>`,
        { Tag: '<b class="tag">static</b>' },
    )
    mount(pageRegion(document.body))
    flushSync()
    ;(document.querySelector('#add') as HTMLElement).click()
    flushSync()

    const painted = document.querySelectorAll('li')[0] as HTMLElement
    const grown = document.querySelectorAll('li')[1] as HTMLElement
    expect(grown.querySelector('b.tag')?.textContent).toBe('static')
    // The same markup either way round, which is the whole claim.
    expect(grown.innerHTML.replace('two', 'one')).toBe(painted.innerHTML)
})

// 10 — `reactive.share(key, create)`, and the three shapes the corpus writes. A scope is the
// COMPONENT INSTANCE and its descendants (10.5), which is why 10.7 refuses a process-wide one: a
// map keyed by name would make the two shelves below one shelf.
const NOW_PLAYING = `<script>
import { reactive } from 'abide'

let playing = reactive.share('nowPlaying', () => reactive('nothing'))
</script>

<strong>{playing}</strong>`

// 10.5, 10.6 — HELD ABOVE BOTH READERS, so each finds it on the way up rather than building one.
// THE REVERT: create in the scope the key was FOUND in rather than the calling one — the two
// shelves below then share one `queued` and the second test reads `jazz` in both.
test('a key an ancestor holds is found on the way up — 10.5', async () => {
    const { html } = await mountPage(
        `<script>
import { reactive } from 'abide'
import NowPlaying from './NowPlaying.abide'

reactive.share('nowPlaying', () => reactive('Kind of Blue'))
</script>
<NowPlaying/><NowPlaying/>`,
        { NowPlaying: NOW_PLAYING },
    )
    // Both readers found the page's value, and neither built `nothing`.
    expect(html).not.toContain('nothing')
    expect(html.match(/Kind of Blue/g)?.length).toBe(2)
})

// 10.6 — CREATED IN THE CALLING SCOPE where no ancestor holds the key, which is what makes two
// instances of one component two values rather than one.
//
// THE PAGE HOLDS A SCOPE OF ITS OWN, and without that this test distinguishes nothing: a page
// that shares nothing opens no scope, so each shelf is the root of its own chain and every
// scheme agrees. It shares an UNRELATED key, which is the smallest thing that makes an ancestor
// scope exist — and the revert then has both shelves reading `jazz`.
test('two instances each hold their own where no ancestor does — 10.6', async () => {
    const shelf = `<script>
import { props, reactive } from 'abide'

const { name } = props<{ name: string }>()
let queued = reactive.share('queued', () => reactive(name))
</script>

<li>{queued}</li>`
    const { html } = await mountPage(
        `<script>
import { reactive } from 'abide'
import Shelf from './Shelf.abide'

reactive.share('library', () => reactive('everything'))
</script>
<ul><Shelf name="jazz"/><Shelf name="ambient"/></ul>`,
        { Shelf: shelf },
    )
    expect(html).toContain('<li>jazz</li>')
    expect(html).toContain('<li>ambient</li>')
})

// 10.1 — ONE CALL GETS OR CREATES, so a second call in the same scope hands back the one that won
// and the value it was given is not it. `share-winner` is the page that demonstrates it.
test('a second call hands back the value that won — 10.1', async () => {
    const { html } = await mountPage(`<script>
import { reactive } from 'abide'

let volume = reactive.share('volume', () => reactive(4))
const built = reactive(9)
const shared = reactive.share('volume', () => built)
</script>
<em>{volume}</em><strong>{shared}</strong><span>{built}</span>`)
    expect(html).toContain('<em>4</em><strong>4</strong><span>9</span>')
})

// 10.2 — THE KEY IS A LITERAL. The scope it gets or creates in is decided where it is written, so
// a key computed at run time is a scope nobody can read off the page.
test('a computed share key is refused — 10.2', async () => {
    const file = parseAbide(`<script>
import { reactive } from 'abide'
const key = 'volume'
let volume = reactive.share(key, () => reactive(4))
</script>
<p>{volume}</p>`)
    const reads = await session.reads(`${ROOT}src/Page.abide`, file)
    let refused = ''
    try {
        emitComponent(file, reads)
    } catch (thrown) {
        refused = String(thrown)
    }
    expect(refused).toContain('RULEBOOK 10.2')
})

// 32.18 INSIDE A `{#for}` — the case a list of components is, and the one the client could not
// build: a row the server never wrote has to be built in the BROWSER, and the child's markup is in
// the child's server module. So the child's client module carries the same template, and the row
// builder asks it (`Row.html(props)`) where the server asks `renderComponent`.
//
// THE ADDED ROW IS THE ASSERTION. The server-rendered rows hydrate whatever the row builder does,
// so a test that only mounts distinguishes nothing — the failure waits for the first row the list
// grows by. THE REVERT: emit the invocation's SERVER form in the row builder (drop the `client`
// arm in `emitInvocation`); the module then imports `renderComponent` from `abide/runtime`, which
// does not export it, and the page does not mount at all.
const ROW = `<script>
import { props } from 'abide'

const { title } = props<{ title: string }>()
</script>

<li>{title}</li>`

test('a component in a {#for} renders, hydrates, and builds the row it grows by — 32.18', async () => {
    const { html, mount } = await mountPage(
        `<script>
import { reactive } from 'abide'
import Row from './Row.abide'

let titles = reactive(['one', 'two'])
</script>

<ul>{#for title of titles}<Row title={title}/>{/for}</ul>
<button onclick={() => { titles = [...titles, 'three'] }}>add</button>`,
        { Row: ROW },
    )

    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>two</li>')

    mount(pageRegion(document.body))
    flushSync()
    const first: unknown = document.querySelector('li')

    ;(document.querySelector('button') as HTMLElement).click()
    flushSync()

    const rows = [...document.querySelectorAll('li')].map(
        (row) => row.textContent,
    )
    expect(rows).toEqual(['one', 'two', 'three'])
    // 41.8 — the rows that survive are MOVED, never remade: the first row is the same node.
    expect(document.querySelector('li') as unknown).toBe(first)
})

// A COMPONENT ROW THE LIST GREW IS ITS WHOLE MARKUP. The row the browser builds is its anchor and
// the child's empty pair; the child fills the pair on the row's MOUNT, after `make` handed its nodes
// over. A row held as the nodes `make` returned moved the pair and left the child's `<li>` standing
// where it was, so a reorder of grown rows put every `<li>` in its old order.
//
// THE REVERT: move a multi-root row by the nodes `make` returned rather than by the range from its
// anchor (`moveRow`). This reports `['a', 'b', 'c']` after the reverse.
test('a component row the list grew reorders with its markup', async () => {
    const { mount } = await mountPage(
        `<script>
import { reactive } from 'abide'
import Row from './Row.abide'

let titles = reactive(['a'])
</script>

<ul>{#for title of titles by title}<Row title={title}/>{/for}</ul>
<button id="grow" onclick={() => { titles = ['a', 'b', 'c'] }}>grow</button>
<button id="reverse" onclick={() => { titles = ['c', 'b', 'a'] }}>reverse</button>`,
        { Row: ROW },
    )
    mount(pageRegion(document.body))
    flushSync()
    const text = (): (string | null)[] =>
        [...document.querySelectorAll('li')].map((row) => row.textContent)
    ;(document.querySelector('#grow') as HTMLElement).click()
    flushSync()
    expect(text()).toEqual(['a', 'b', 'c'])
    ;(document.querySelector('#reverse') as HTMLElement).click()
    flushSync()
    expect(text()).toEqual(['c', 'b', 'a'])
})

// 10.5 THROUGH A ROW ADDED LATER — a descendant is a descendant whenever it was created. The row
// the list grows by is mounted from a `watch` effect, with no caller on the stack, so the instance
// captures its own share scope at mount and the deferred mount puts it back.
// THE REVERT: drop the `resumes` arm in `mountFunction`; the added row reads `nothing` — it opened
// a chain of its own and built the value the page already holds, which is the one failure mode a
// scope has: two values under one key and each half of the page reading a different one.
test('a row added after mount shares with the page above it — 10.5', async () => {
    const row = `<script>
import { reactive } from 'abide'

let playing = reactive.share('nowPlaying', () => reactive('nothing'))
</script>

<li>{playing}</li>`
    const { mount } = await mountPage(
        `<script>
import { reactive } from 'abide'
import Row from './Row.abide'

reactive.share('nowPlaying', () => reactive('Kind of Blue'))
let titles = reactive(['one'])
</script>

<ul>{#for title of titles}<Row/>{/for}</ul>
<button onclick={() => { titles = [...titles, 'two'] }}>add</button>`,
        { Row: row },
    )
    mount(pageRegion(document.body))
    flushSync()
    ;(document.querySelector('button') as HTMLElement).click()
    flushSync()

    expect(
        [...document.querySelectorAll('li')].map((row) => row.textContent),
    ).toEqual(['Kind of Blue', 'Kind of Blue'])
})

// A REMOVED ROW STOPS ITS CHILD'S BINDINGS TOO. Every binding a region opens goes on a `Scope` so
// that what replaced it can stop it — and a component opens its own, inside its own mount. Left
// where the caller cannot reach it, a dropped row's child goes on waking for every write and
// writing into nodes that are not in the document: the page looks right and does the work twice.
//
// THE WORK IS THE ASSERTION, because the output cannot see this at all — the detached nodes are
// gone from the page whether or not anything is still writing into them. THE REVERT: have the
// emitted invocation discard what the child's mount hands back; `bindingRuns` reads 2 where 1 is
// due, and it is 2 whatever the page shows.
test('a row that leaves stops the bindings its component opened — 12.4', async () => {
    const row = `<script>
import { props } from 'abide'

const { label } = props<{ label: string }>()
</script>

<li>{label}</li>`
    const { mount } = await mountPage(
        `<script>
import { reactive } from 'abide'
import Row from './Row.abide'

let rows = reactive(['one', 'two'])
let mark = reactive('')
</script>

<ul>{#for row of rows by row}<Row label={row + mark}/>{/for}</ul>
<button id="drop" onclick={() => { rows = ['one'] }}>drop</button>
<button id="bump" onclick={() => { mark = '!' }}>bump</button>`,
        { Row: row },
    )
    mount(pageRegion(document.body))
    flushSync()
    expect(document.querySelectorAll('li').length).toBe(2)

    const click = (id: string): void => {
        ;(document.querySelector(id) as HTMLElement).click()
        flushSync()
    }
    click('#drop')
    expect(document.querySelectorAll('li').length).toBe(1)

    // ONE ROW IS LEFT, so one binding may run. The dropped row's child reads `mark` too.
    const work = measure(() => {
        click('#bump')
    })
    expect(work.bindingRuns).toBe(1)
    expect(document.querySelector('li')?.textContent).toBe('one!')
})

// A COMPONENT'S LIST GROWS A ROW. A component is mounted on the `Region` its caller wrote, not on a
// node, so a build that asked `root` for its document was handed the region record — and the first
// row a component's list grew threw `createElement is not a function`. Nothing had grown one: every
// component test hydrates what the server wrote. The document is now the region's own, handed to
// every build by `fillRegion` and by the list's reconcile.
//
// THE REVERT: make a row's build take its document from `root` again — `__document = root.ownerDocument
// ?? root` at the head of `emitList`'s `make`. This throws the `TypeError` out of the click.
test('a component whose list grows a row builds it in the right document', async () => {
    const LIST = `<script>
import { reactive } from 'abide'
let rows = reactive(['a'])
</script>
<ul id="grown">{#for row of rows}<li>{row}</li>{/for}</ul>
<button id="grow" onclick={() => { rows = [...rows, 'b'] }}>grow</button>`
    const { mount } = await mountPage(
        `<script>
import List from './List.abide'
</script>
<main><List/></main>`,
        { List: LIST },
    )
    mount(pageRegion(document.body))
    ;(document.querySelector('#grow') as HTMLElement).click()
    flushSync()
    expect(
        [...document.querySelectorAll('#grown li')].map((li) => li.textContent),
    ).toEqual(['a', 'b'])
})

const STEPPER = `<script>
import { props } from 'abide'

const { count } = props<{ count: number }>()
</script>

<button class="step" onclick={() => { count += 1 }}>{count}</button>`

const STEPPED = `<script>
import { reactive } from 'abide'
import Stepper from './Stepper.abide'

let bound = reactive(1)
let passed = reactive(10)
let cents = reactive(300)
</script>

<p id="bound"><Stepper bind:count={bound}/>{bound}</p>
<p id="pair"><Stepper bind:count={{ get: () => cents / 100, set: (dollars) => { cents = dollars * 100 } }}/>{cents}</p>
<p id="passed"><Stepper count={passed}/>{passed}</p>
<button id="reset" onclick={() => { passed = 20 }}>reset</button>`

// 33.6, 33.7 — THE CALLER DECIDES WHERE A CHILD'S WRITE GOES, and the child is one component either
// way. Bound, the write is the caller's value; passed, it stands in the child until the caller's
// value moves, and then the caller's wins. THE REVERTS: build `propCell`'s cell over `read()`
// rather than `read(true)`, and `#bound` reads "21" — the child on 2, the caller still on 1; or
// `set` an empty `reactive` once from `read(true)` rather than computing it, and the bound half
// still passes while the reset reads "1120" — the child kept 11 over the caller's 20.
test("a child's write goes where the caller bound it — 33.6, 33.7", async () => {
    const { mount } = await mountPage(STEPPED, { Stepper: STEPPER })
    mount(pageRegion(document.body))
    flushSync()
    const text = (id: string): string =>
        (document.getElementById(id) as Element).textContent ?? ''
    const step = (id: string): void => {
        ;(document.querySelector(`#${id} .step`) as HTMLElement).click()
        flushSync()
    }

    step('bound')
    expect(text('bound')).toBe('22')

    // 32.6 — a pair binds a component as it binds an element: the child reads `get` and its
    // write is `set`.
    expect(text('pair')).toBe('3300')
    step('pair')
    expect(text('pair')).toBe('4400')

    step('passed')
    expect(text('passed')).toBe('1110')
    ;(document.getElementById('reset') as HTMLElement).click()
    flushSync()
    expect(text('passed')).toBe('2020')
})
