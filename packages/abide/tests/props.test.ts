// 32.19 AND 33 — A COMPONENT AND ITS PROPS, END TO END. The parent renders the child where it
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
            emitClient(file, reads) || 'export default () => {}'
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
test('a component renders where it stands, and its prop is the caller expression — 32.19, 33.5', async () => {
    const { html } = await mountPage(PAGE, { Total: TOTAL })

    expect(html).toContain('<strong>USD 1240.00</strong>')
    expect(html).not.toContain('<Total')
    // The child's markup is one region, anchored: 32.19's pair, and nothing else added.
    expect(html).toContain(
        '<li><!--[--><strong>USD 1240.00</strong><!--]--></li>',
    )
})

// 33.5 — A LIVE READ, NOT A SNAPSHOT, and the counts are how that is told from a re-render. ONE
// binding wakes in the child, and no node is created: the child's own text node, written by the
// server, is the one that moves.
test('a prop re-reads when the caller value moves, and nothing is rebuilt — 33.5', async () => {
    const { mount } = await mountPage(PAGE, { Total: TOTAL })
    mount(document.body)
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

// 32.19 THROUGH THE BUILD — A CHILD WITH NOTHING TO HYDRATE STILL SHIPS A MODULE, because the
// caller's client module imports one by name. "A static page ships no client" is the rule this is
// the exception to, and the import is what forces it: the child is static, the page is not, and
// the page's `import Static from './Static.client.ts'` has to resolve to something.
// THE REVERT: write the client module on `client !== ''` alone, as the build did before — the
// page's client module imports a file that is not there, and nothing until a browser says so.
test('an invoked static component still gets a client module — 32.19', async () => {
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

    expect(await Bun.file(`${out}/Static.client.ts`).text()).toBe(
        'export default () => {}\n',
    )
    expect(await Bun.file(`${out}/page.client.ts`).text()).toContain(
        "from './Static.client.ts'",
    )
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

// 32.19 INSIDE A REGION IS REFUSED, and the refusal is the honest half of what is built: the
// client builds a new row's markup itself, and a component's markup is in the child's own SERVER
// module — which the browser may not reach. Served without the refusal, the page renders and the
// rows inside it are dead, which is the failure nothing on screen reports.
test('a component inside a {#for} is refused rather than served dead — 32.19', async () => {
    const file = parseAbide(`<script>
import Row from './Row.abide'
const titles = ['one', 'two']
</script>
<ul>{#for title of titles}<Row title={title}/>{/for}</ul>`)
    let refused = ''
    try {
        emitClient(file, [])
    } catch (thrown) {
        refused = String(thrown)
    }
    expect(refused).toContain('RULEBOOK 32.19')
})
