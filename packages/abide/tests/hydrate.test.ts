// THE CLIENT HALF, END TO END. The server renders a document, the client mounts into the very
// nodes the server wrote, a real click runs a real handler, and the text the browser shows moves.
//
// The counts are the point rather than the text. A binding that produces the right string by
// rebuilding the subtree produces the right string, and CLAUDE.md's rule is that a correctness
// test cannot guard a "does less work" contract — so the gate is on nodes created and elements
// moved, both of which a naive re-render would raise and neither of which changes the output.

import { afterAll, expect, test } from 'bun:test'
import { measure } from 'harness/measure'
import { compileFile, emitClient, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync } from '#shared'
import { pageRegion } from '#ui/regions.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'
import { clientOf, closeTyped } from './typed.ts'

afterAll(closeTyped)

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)

afterAll(() => {
    session.close()
    removeTemporaryModules()
})

const PAGE = `<script>
import { reactive } from 'abide'

let count = reactive(0)
const label = 'clicks'
</script>

<p id="out">{label}: {count}</p>
<button onclick={() => count = count + 1}>more</button>`

async function mountPage(source: string) {
    const file = parseAbide(source)
    const reactive = await session.reads(`${ROOT}src/page.abide`, file)

    const dir = temporaryModule({
        'Page.ts': compileFile(source, reactive),
        'Page.client.ts': emitClient(file, reactive),
    })

    const { default: Component } = await import(`${dir}/Page.ts`)
    let html = ''
    for await (const chunk of render(
        Component,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        html += new TextDecoder().decode(chunk)

    // The client mounts into the SERVER's nodes. Setting innerHTML is how a browser would have
    // arrived at them; nothing is rebuilt from the template.
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + '<body>'.length,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    return { html, mount }
}

test('a click runs the handler and the slot the server wrote is the slot that moves', async () => {
    const { html, mount } = await mountPage(PAGE)

    // The server rendered the initial value, so the document is right before any script runs.
    // ONE TEXT RUN, written whole and carrying nothing the author did not. `{label}: {count}`
    // merges into a single text node when parsed, so there is nothing to separate and nothing
    // invented to separate it with.
    expect(html).toContain('<p id="out">clicks: 0</p>')
    // The page's own pair (41.9) and not one comment more.
    expect((html.match(/<!--/g) ?? []).length).toBe(2)
    expect(html).not.toContain('data-a')
    // 32.4 — the handler is a listener, and the server writes no `onclick` for it to fire from.
    expect(html).not.toContain('onclick')

    // MEASURED AT MOUNT, not only at the click, and the difference is where the gate lives.
    // 12.2 runs an effect immediately, so a binding opened for a static slot runs HERE and
    // never again — a click-only measurement reports the same 1 with the mechanism out and
    // distinguishes nothing, which is what the revert showed when this was written that way.
    const mountWork = measure(() => {
        mount(pageRegion(document.body))
        flushSync()
    })
    // Two slots on this page, ONE of which reads a reactive value. THE REVERT: drop the
    // `isLiveRun` check in `emitClient`; this reports `bindingRuns` 1 -> 2 and `wakes`
    // 1 -> 2, and both grow with every static slot on the page.
    expect(mountWork.bindingRuns).toBe(1)
    expect(mountWork.wakes).toBe(1)

    const out = document.querySelector('#out') as HTMLElement
    const button = document.querySelector('button') as HTMLElement
    expect(out.textContent).toBe('clicks: 0')

    // THE REVERT: have `emitClient` re-render the element (`out.innerHTML = ...`) instead of
    // writing the slot's text node. The text is identical and this reports `nodesCreated` 0 -> 3
    // and `elementsMoved` 0 -> 1, neither of which the output shows.
    const work = measure(() => {
        button.click()
        flushSync()
    })
    expect(out.textContent).toBe('clicks: 1')
    expect(work.nodesCreated).toBe(0)
    expect(work.elementsMoved).toBe(0)
    expect(work.textMoved).toBe(0)

    // On the CLICK only the reactive slot may re-run. A static slot's binding, if one were
    // opened, would not show up here at all — which is exactly why the mount is measured above.
    expect(work.bindingRuns).toBe(1)
    expect(work.wakes).toBe(1)
})

// A RUN reading nothing reactive is written once by the server and never again. The page below
// has TWO runs — one static, one live — which is what makes the case distinguish: a page whose
// only run is live reports one binding whether the check is there or not. THE REVERT: drop
// `isLiveRun` in `emitClient` and bind every run; this reports 2 bindings where 1 is due, and
// the mount gate below reports `bindingRuns` 2 where it reports 1.
test('a run that reads nothing reactive opens no binding', async () => {
    const source = `<script>
import { reactive } from 'abide'

let count = reactive(0)
const label = 'clicks'
</script>

<p id="static">{label}</p>
<p id="live">{count}</p>`

    const file = parseAbide(source)
    const names = await session.reads(`${ROOT}src/page.abide`, file)
    const client = emitClient(file, names)

    // The live run is the only one bound, found through the `<p>` it stands in.
    expect(client).toContain('const __c3 = __runHere(__c2?.firstChild, __c2)')
    expect(client).toContain('__setText(__t3,')
    // The STATIC run is not even WALKED. It stands inside the first `<p>`, and the second `<p>`
    // is found from the first one's `nextSibling` — not by counting inside it — so nothing after
    // the static run is found through it and there is nothing for its node to hold a place for.
    expect(client).not.toContain('__c0?.firstChild')
    expect(client.match(/__runHere\(/g) ?? []).toHaveLength(1)
    // `watchEffect` at the top level, `watch` inside a `{#if}` arm — the second is a local that
    // collects its disposer so a branch swap can stop it. Either spelling counts as a binding.
    expect(client.match(/watch(Effect)?\(/g) ?? []).toHaveLength(1)
})

// A page with nothing to hydrate emits no client module at all, which is what makes "this page
// ships no runtime" a fact about the build rather than a claim about the bundler.
test('a static page emits no client module', async () => {
    expect(await clientOf('<h1>static</h1>', [])).toBe('')
})

// 41.4 — A RENDER MUST CONTINUE PAST A VALUE STILL IN FLIGHT, and 32.24 is what the slot itself
// does: a template expression a `NotLanded` aborted leaves what it last rendered, which on a first
// server render is nothing. Together they are one page with a hole in it, not no page at all.
//
// THE WHOLE DOCUMENT WAS LOST. `emitComponent` builds the body as ONE concatenation, so the first
// unlanded read threw out of `Component()` and `render` died on its first `next()` — the static
// markup around the slot, every other slot, and the `<head>` with it. Twelve corpus examples
// stopped here, and what made it invisible is that each of them is a page whose ONLY interesting
// value is the one in flight, so "the page did not render" and "the slot did not render" look the
// same until you ask for the markup beside it.
//
// THE SLOT IS ADDRESSABLE AFTERWARDS, which is the half that makes the hole legal rather than a
// mismatch waiting to happen: a run every part of which is an expression is `blank` (`isBlankRun`),
// and the client's walk puts its text node back as it passes (`runHere`). That mechanism
// predates this and is why the fix is a catch rather than a placeholder node.
//
// THE REVERT: make `unlandable` answer `lowered` unconditionally, so `emitNode`'s expression arm
// emits `escapeText(...)` directly — `render` throws `NotLanded: reactive has not landed` and this
// test reports no document at all rather than a document with one empty slot.
test('a render continues past a value still in flight — 41.4, 32.24', async () => {
    const { html, mount } = await mountPage(`<script>
import { reactive } from 'abide'

const invoice = reactive(() => Promise.resolve({ number: 'INV-1' }))
</script>

<main><h1 id="static">Invoice</h1><strong id="slot">{invoice.number}</strong></main>`)

    // THE PAGE IS THERE. The static markup either side of the hole is what the old behaviour
    // dropped, so asserting the hole alone would pass against a render that emitted nothing.
    expect(html).toContain('<h1 id="static">Invoice</h1>')
    expect(html).toContain('<strong id="slot">')
    expect(document.querySelector('#static')?.textContent).toBe('Invoice')
    // The hole: 32.24 leaves what it last rendered, and nothing has been rendered yet.
    expect(document.querySelector('#slot')?.textContent).toBe('')

    // AND IT FILLS. The client re-runs the body (41.6), the value lands, and the binding writes
    // into a text node that was not in the document the server wrote — which is `blank`'s arm.
    mount(pageRegion(document.body))
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
    expect(document.querySelector('#slot')?.textContent).toBe('INV-1')
})

// 41.4 THROUGH A BLOCK'S ONE EXPRESSION. A `{#for}` reads its subject once for the whole block
// (32.22), so an unlanded subject took the page down the same way a slot did — and the fallback
// needs no deciding, because 32.23 already says an absent subject iterates zero times and
// `listOf` already answers `[]` for absent. The abort just makes "in flight" reach it.
//
// TWO REVERTS, BECAUSE THE SERVER HALF ALONE IS THE WORSE BUG. Drop the `slotValue` wrapper from
// the `{#for}` arm of `emitNode` and `render` throws: no document, loudly. Drop `hydrate`'s
// `found.length === 0` bail instead and the document is served, the list is empty, and it stays
// empty for ever — the watch that would have hydrated the rows threw on the same subject, so
// `hydrating` was still set when the value landed and the rows were walked against nothing. This
// test reports [] against [north, south] either way, and only the second one looks fine on screen.
test('a render continues past a {#for} subject still in flight — 41.4, 32.23', async () => {
    const { html, mount } = await mountPage(`<script>
import { reactive } from 'abide'

const rows = reactive(() => Promise.resolve(['north', 'south']))
</script>

<main><h1 id="static">Regions</h1><ul id="list">{#for row of rows by row}<li>{row}</li>{/for}</ul></main>`)

    expect(html).toContain('<h1 id="static">Regions</h1>')
    // The block rendered its anchors and no rows, which is 32.23's zero times.
    expect(document.querySelectorAll('#list li')).toHaveLength(0)

    mount(pageRegion(document.body))
    // A MACROTASK, NOT TWO MICROTASKS. The subject lands in a microtask, the list reconciles in
    // the turn the write wakes, and a slot that is one read is ready a tick sooner than a block
    // that has to build rows — which is why the text case above needs less than this one.
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(
        [...document.querySelectorAll('#list li')].map((n) => n.textContent),
    ).toEqual(['north', 'south'])
})

// 41.4 AT THE TWO POSITIONS THE FIRST PASS DID NOT REACH. A text slot and a `{#for}` subject were
// guarded; an attribute value and a `style:` value were not, and nothing noticed because only
// `element-ref` reads an unlanded value from an attribute and no corpus page reads one from a
// `style:`. One class of bug, closed in the two shapes that happened to be tried.
//
// AND THE HOLE FILLS, which is the half that makes guarding legal rather than a silent wrong
// value: 32.3's binding re-runs on the value that landed and writes it into the attribute the
// server left empty, exactly as `blank` does for a text run. Before that binding existed the
// empty attribute was permanent, and the test below asserted it and called that the answer.
//
// EACH ABSENCE IS THE ONE ALREADY DECIDED WHERE IT LANDS — an attribute holding `undefined` is
// absent (32.38), and `escapeStyleValue` reads it as '' through `textOf`, so nothing new was decided
// to make this work.
//
// THE REVERT: make `unlandable` answer `lowered` unconditionally and `render` throws
// `NotLanded: reactive has not landed` — no document at all, on a page whose static markup is
// most of it. This test then reports nothing rendered rather than a page with two empty values.
test('a render continues past an unlanded attribute and style — 41.4', async () => {
    const { html, mount } = await mountPage(`<script>
import { reactive } from 'abide'

const tone = reactive(() => Promise.resolve('warm'))
const width = reactive(() => Promise.resolve('40px'))
</script>

<main><h1 id="static">Panel</h1><p id="attr" title={tone}>t</p><b id="styled" style:width={width}>w</b></main>`)

    // THE PAGE IS THERE, which is the whole claim — asserting the holes alone would pass against
    // a render that emitted nothing at all.
    expect(html).toContain('<h1 id="static">Panel</h1>')
    expect(document.querySelector('#static')?.textContent).toBe('Panel')
    // The holes: both values are still in flight, so both render as the absence they escape to.
    expect(document.querySelector('#attr')?.hasAttribute('title')).toBe(false)
    expect(html).not.toContain('40px')
    expect(document.querySelector('#styled')?.getAttribute('style')).toBe(
        'width: ',
    )

    // AND BOTH FILL. THE REVERT: drop the `plan.attributes` loop in `emitRegion` — the document
    // is identical and both values stay empty for the life of the page.
    mount(pageRegion(document.body))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(document.querySelector('#attr')?.getAttribute('title')).toBe('warm')
    expect((document.querySelector('#styled') as HTMLElement).style.width).toBe(
        '40px',
    )
})

// 32.38 — `disabled="false"` IS A DISABLED BUTTON. A whole-value attribute was written as its text,
// so `disabled={busy}` shipped every button disabled whatever `busy` held, and the docs' own cards
// were written around it. Presence is the answer for an attribute HTML reads by presence; text for
// every other, where `aria-busy="false"` means something its absence does not; and `undefined`
// is absent for all of them — on the server, in a binding, in a row the browser builds and through
// a spread alike.
//
// THE REVERT: skip the `BOOLEAN_ATTRIBUTES` arm of `attributeText`; the server then writes
// `disabled="false"` and `hidden="false"`, and the first assertion reports it.
test('a boolean attribute is present or absent, and any other is its text — 32.38', async () => {
    const { html, mount } = await mountPage(`<script>
import { reactive } from 'abide'

let busy = reactive(false)
let rows = reactive([{ id: 1, off: true }])
const shown = reactive(() => ({ hidden: busy(), 'aria-hidden': busy() }))

function flip() {
    busy = !busy
    rows = [...rows, { id: rows.length + 1, off: false }]
}
</script>

<main><button id="b" disabled={busy} aria-busy={busy} title={undefined}>go</button><div id="s" {...shown}>s</div><button id="flip" onclick={flip}>flip</button><ul>{#for row of rows by row.id}<li><input id={'r' + row.id} disabled={row.off}></li>{/for}</ul></main>`)

    expect(html).toContain('<button id="b" aria-busy="false">')
    expect(html).toContain('<div id="s" aria-hidden="false">')
    expect(html).toContain('<input id="r1" disabled>')

    mount(pageRegion(document.body))
    flushSync()
    const button = document.querySelector('#b') as HTMLElement
    const flipButton = document.querySelector('#flip') as HTMLElement
    flipButton.click()
    flushSync()
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('disabled')).toBe('')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(document.querySelector('#s')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('#s')?.getAttribute('aria-hidden')).toBe(
        'true',
    )
    // A row the browser built: absent where its value is false.
    expect(document.querySelector('#r2')?.hasAttribute('disabled')).toBe(false)
    expect(document.querySelector('#r1')?.hasAttribute('disabled')).toBe(true)

    flipButton.click()
    flushSync()
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(button.hasAttribute('title')).toBe(false)
    expect(document.querySelector('#s')?.hasAttribute('hidden')).toBe(false)
})

// 32.38 — A STRING THAT MAKES A PRESENCE ATTRIBUTE PRESENT IS ITS TEXT. `hidden` is one, and
// `hidden="until-found"` is a real value: written bare, the content is hidden for good and a reader's
// find-in-page can no longer reveal it. THE REVERT: answer `''` for every truthy value in
// `attributeText`'s presence arm; the server writes a bare `hidden` and the binding does too.
test('a presence attribute given a string carries it — 32.38', async () => {
    const { html, mount } = await mountPage(`<script>
import { reactive } from 'abide'

let found = reactive<string | boolean>('until-found')
</script>

<main><div id="d" hidden={found}>d</div><button id="f" onclick={() => (found = found === true ? 'until-found' : true)}>f</button></main>`)

    expect(html).toContain('<div id="d" hidden="until-found">')
    mount(pageRegion(document.body))
    flushSync()
    const toggle = document.querySelector('#f') as HTMLElement
    toggle.click()
    flushSync()
    expect(document.querySelector('#d')?.getAttribute('hidden')).toBe('')
    toggle.click()
    flushSync()
    expect(document.querySelector('#d')?.getAttribute('hidden')).toBe(
        'until-found',
    )
})

// 41.4 AT THE LAST POSITION, and the one that needed a signal rather than a fallback. An `{#if}`
// subject guarded to `undefined` is FALSY, so the chain walks on and paints the `{:else}` arm —
// a decision the client cannot tell from one the author's own value made. It reads the landed
// value a turn later, picks the other arm, and hydrates against the arm the server actually
// wrote; where that arm holds no binding there is nothing to walk and 41.10 never fires, so the
// region is wrong until the condition CHANGES.
//
// SO THE ABORT EMPTIES THE REGION, and `isEmptyRegion` — 32.18's signal for a component whose row
// the browser grew — is what the block's first run reads to fill instead of hydrate. Nothing was
// added to the document to carry it.
//
// THE `{:else}` ARM IS WHAT MAKES THE CASE DISTINGUISH. Without it an aborted chain and a chain
// that took the false arm both render nothing, so the test passes against the bug; with it, the
// old behaviour puts `off` in the document and leaves it there.
//
// TWO REVERTS. Drop the `slotValue` wrapper from the `{#if}` arm of `emitNode` and `render`
// throws `NotLanded` — no document at all. Drop the `isEmptyRegion` arm of the block's watch in
// `emitClient` instead and the document is served with an empty region that never fills.
test('a render continues past an {#if} subject still in flight — 41.4, 32.12', async () => {
    const { html, mount } = await mountPage(`<script>
import { reactive } from 'abide'

const shown = reactive(() => Promise.resolve(true))
</script>

<main><h1 id="static">Panel</h1>{#if shown}<span id="arm">on</span>{:else}<span id="off">off</span>{/if}</main>`)

    // THE PAGE IS THERE, and NEITHER ARM IS. The region carries its anchors and nothing between
    // them, which is the whole of what the client reads.
    expect(html).toContain('<h1 id="static">Panel</h1>')
    expect(html).not.toContain('id="arm"')
    expect(html).not.toContain('id="off"')

    mount(pageRegion(document.body))
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(document.querySelector('#arm')?.textContent).toBe('on')
    expect(document.querySelector('#off')).toBeNull()
})

// 32.3 — `name={expr}` IS REACTIVE, and the binding is what makes it so. The server writes the
// value standing at render and, without this, nothing ever writes it again: a page whose `{tone}`
// text moved while its `title={tone}` stayed behind is what shipped, and no assertion on the slot
// could see it — the two read the same value, so the one that worked hid the one that did not.
//
// BOTH POSITIONS ON ONE PAGE, which is what makes the case distinguish. A page with only the
// attribute reports the server's value on the first read whether a binding exists or not; it is
// the SECOND read, after a write, that parts them.
//
// THE REVERT: drop the `plan.attributes` loop in `emitRegion`. The document is byte-identical and
// the text beside it still moves; this reports `calm` where `urgent` is due.
test('an attribute expression keeps moving after hydration — 32.3', async () => {
    const { html, mount } = await mountPage(`<script>
import { reactive } from 'abide'

let tone = reactive('calm')
const kind = 'card'
</script>

<main><p id="out" class="card" data-kind={kind} title={tone}>{tone}</p>
<button id="go" onclick={() => { tone = 'urgent' }}>go</button></main>`)

    // The server wrote the value standing at render, so the attribute is right with no JS at all.
    expect(html).toContain('title="calm"')

    // ONE BINDING PER LIVE POSITION AND NONE FOR THE OTHER TWO. `class="card"` never reaches the
    // plan at all — it holds no expression — and `data-kind={kind}` does, which is the one the
    // `isLive` check is actually for: an expression that reads nothing reactive is written once
    // by the server and never moves, and a binding for it is a reader woken on every page for
    // nothing. The static attribute cannot distinguish that, and asserting it was the whole of
    // this gate until the revert showed nothing failing.
    // THE REVERT: drop the `isLive` check in the attribute loop; this reports 3.
    const mountWork = measure(() => {
        mount(pageRegion(document.body))
        flushSync()
    })
    expect(mountWork.bindingRuns).toBe(2)

    const out = document.querySelector('#out') as HTMLElement
    expect(out.getAttribute('title')).toBe('calm')

    const work = measure(() => {
        ;(document.querySelector('#go') as HTMLElement).click()
        flushSync()
    })
    expect(out.getAttribute('title')).toBe('urgent')
    expect(out.textContent).toBe('urgent')
    // Both unbound attributes are untouched, and still carry what the server wrote.
    expect(out.getAttribute('class')).toBe('card')
    expect(out.getAttribute('data-kind')).toBe('card')
    // ONE ATTRIBUTE WRITE FOR ONE ATTRIBUTE THAT MOVED. THE REVERT: drop the compare in
    // `setAttribute` and this stays 1 here — but the mount above reports `attributesSet` 1 where
    // it reports 0, because hydration re-runs every binding on a value that has not moved.
    expect(work.attributesSet).toBe(1)
    expect(mountWork.attributesSet).toBe(0)
})

// 32.10 END TO END — a `class:name` keeps moving after hydration, and the author's own `class`
// survives it. THE TWO HALVES ARE ONE CASE: the server MERGED `class="badge"` and `class:overdue`
// into a single attribute, so a binding that wrote that attribute back would produce the right
// class and take `badge` off the element in the same write. Only the element's own class list can
// part them, and only a page carrying both names can tell that it did.
//
// THE REVERT: point the `class` row of `WRITES` at `setAttribute`. The document the server writes
// is byte-identical; this reports `badge` where `badge overdue` is due — the name a class binding
// carries is the CLASS and not the attribute, so the reverted write puts an attribute called
// `overdue` on the element and the class list never moves at all.
test('a class: directive toggles one class and keeps the others — 32.10', async () => {
    const { html, mount } = await mountPage(`<script>
import { reactive } from 'abide'

let late = reactive(false)
</script>

<main><p id="out" class="badge" class:overdue={late}>x</p>
<button id="go" onclick={() => { late = true }}>go</button></main>`)

    // ONE `class` ATTRIBUTE ON THE TAG, holding what the condition said at render — which is the
    // page being right with no JS at all.
    expect(html).toContain('class="badge"')
    expect(html).not.toContain('overdue')

    mount(pageRegion(document.body))
    flushSync()

    const out = document.querySelector('#out') as HTMLElement
    const work = measure(() => {
        ;(document.querySelector('#go') as HTMLElement).click()
        flushSync()
    })
    // THE WHOLE LIST, not the one name: `contains('overdue')` is true of an element whose `badge`
    // the write took with it, which is exactly the failure the class list is chosen to avoid.
    expect(out.className).toBe('badge overdue')
    // ONE CLASS WRITE AND NO ATTRIBUTE WRITE. The counter counts the CALL rather than the
    // mutation, so this says which write the binding chose and not what the DOM then did with it
    // — see `setClass` for why the second question has no instrument in this substrate.
    expect(work.classWrites).toBe(1)
    expect(work.attributesSet).toBe(0)
})

// 31.3 — AN `await` OPERAND HOLDS THE `Reactive`, WHEREVER AN `await` IS LEGAL. Every `Reactive`
// is a promise for its own settling (1.4, 2.8), so this is the same line a `.ts` file writes and
// it means the same thing. Lowered as a read (31.1) it would be `await total()` — what has landed,
// and a throw where nothing has (2.10), which is never what an `await` asked for.
//
// IN A HANDLER, BECAUSE 34.3 IS WHY. Setup is a function body on both sides and may not await at
// its top level, so the positions left are the ones inside a function — a handler, a `reactive`
// body — and a handler is the one a test can drive.
//
// THE REVERT: drop the `AwaitExpression` arm of `classifyRead`. The click then runs
// `await total()` on a value that has not landed and the handler throws `NotLanded` instead of
// moving the text to 42.
test('an await operand holds the Reactive — 31.3', async () => {
    const { mount } = await mountPage(`<script>
import { reactive } from 'abide'

const total = reactive(async () => {
    await Bun.sleep(20)
    return 42
})
let shown = reactive('waiting')
</script>

<p id="out">{shown}</p>
<button id="go" onclick={async () => { shown = String(await total) }}>go</button>`)

    mount(pageRegion(document.body))
    flushSync()
    ;(document.querySelector('#go') as HTMLElement).click()
    await new Promise((resolve) => setTimeout(resolve, 60))
    flushSync()
    expect(document.querySelector('#out')?.textContent).toBe('42')
})

// 34.3 — A SCRIPT BLOCK MAY NOT AWAIT AT ITS TOP LEVEL, and the compiler says so. Setup is a
// function body on both sides, so nothing holds the render: every value a page reads is a hole the
// document is written around (41.4, 32.24).
//
// BOTH BLOCKS, AND THE SERVER IS WHY. `<script module>` is request-local there (34.2), so the
// emitted component carries its body too — in a browser that same block IS module scope, where the
// line is legal, and a source that compiles on one side and not the other is what this refuses.
//
// THE REVERT: drop the two `refuseTopLevelAwait` calls in `projectShadow`. Both compiles succeed
// and the import reports `AggregateError: 2 errors building …/Page.ts` — a bundler error against a
// file the author never wrote.
test('a script block cannot await at its top level — 34.3', async () => {
    for (const block of ['<script>', '<script module>']) {
        let thrown = ''
        try {
            await mountPage(`${block}
const rows = await Promise.resolve(1)
</script>

<p id="out">{rows}</p>`)
        } catch (error) {
            thrown = String(error)
        }
        expect(thrown).toContain(`a ${block} cannot await at its top level`)
    }
})

// A TEMPLATE POSITION CANNOT AWAIT EITHER, and for its own reason: every slot, subject and
// attribute value is lowered into an ordinary arrow inside the markup concatenation, so there is
// no function for an `await` to belong to at all. Apart from 34.3 because the refusal is the
// checker's slot walk rather than the projection's, and a slot has no top level to speak of.
//
// THE REVERT: drop the `await` throw from `slotFacts`. The compile succeeds and the
// import of the emitted module reports the same bundler error, naming neither the page nor the
// slot.
test('a template position cannot await', async () => {
    let thrown = ''
    try {
        await mountPage(`<script>
import { reactive } from 'abide'

const rows = reactive(async () => 1)
</script>

<p id="out">{await rows}</p>`)
    } catch (error) {
        thrown = String(error)
    }
    expect(thrown).toContain('a template position cannot await')
})

// AND A SLOT THAT MAKES ITS OWN `async` MAY AWAIT IN IT — the half the guard above got wrong on
// its first run, which is why it is a test rather than a note. `onclick={async () => …}` is an
// ordinary handler and the `await` belongs to the arrow the author wrote; refused, a shape that
// had always worked stopped compiling.
//
// THE REVERT: drop the `FUNCTIONS` arm of `slotFacts`. This reports
// `a template position cannot await` against a page that is entirely correct.
test('a slot that declares its own async may await in it', async () => {
    const { mount } = await mountPage(`<script>
import { reactive } from 'abide'

let shown = reactive('idle')
const later = async () => 'done'
</script>

<p id="out">{shown}</p>
<button id="go" onclick={async () => { shown = await later() }}>go</button>`)

    mount(pageRegion(document.body))
    flushSync()
    ;(document.querySelector('#go') as HTMLElement).click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(document.querySelector('#out')?.textContent).toBe('done')
})

// 41.10 — A MISMATCH MUST NOT REBUILD THE PAGE, and the page is the one region with no block
// around it to rebuild instead. `Mismatch` was written against exactly the failure this guards:
// an ordinary throw out of `mount` skips every binding and listener after the one that refused,
// so a page whose first slot disagrees is served looking right and completely dead below it.
//
// ONE `try` AROUND THE WHOLE ROOT WAS THAT SAME FAILURE WITH A WARNING ON IT. It caught the throw
// and still lost the rest, so the clause read as satisfied while the page was as dead as before.
//
// THE SECOND SLOT AND THE LISTENER ARE BOTH ASSERTED, because they fail differently: the binding
// is a `watch` that never opened and the listener is an `addEventListener` that never ran, and a
// test that only clicked would pass against a page whose text bindings were all lost.
//
// THE REVERT: put `lines.join('\n')` back inside one `try` in `emitClient`. The first binding
// still warns, and this reports `B` where `B2` is due.
test('a mismatch in one root binding does not stop the next — 41.10', async () => {
    const { mount } = await mountPage(`<script>
import { reactive } from 'abide'

let a = reactive('A')
let b = reactive('B')
</script>

<main><p id="one">a{a}</p><p id="two">b{b}</p>
<button id="go" onclick={() => { b = 'B2' }}>go</button></main>`)

    // THE SHAPE THE SERVER WROTE, BROKEN ON PURPOSE. An element where the run's text node stands
    // is what a server and a client that disagree about a region produce, and the run carries a
    // static character so it is not `blank` — a blank run would have its node put back rather
    // than refusing, which is the other arm and not this one.
    const one = document.querySelector('#one') as HTMLElement
    one.innerHTML = '<em>aA</em>'

    mount(pageRegion(document.body))
    flushSync()

    // THE BINDING AFTER THE REFUSAL IS LIVE.
    ;(document.querySelector('#go') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#two')?.textContent).toBe('bB2')
    // And so is the listener, which stands in a later unit again.
    expect(document.querySelector('#one')?.textContent).toBe('aA')
})

// 32.28 IN A RUN THAT MOVES. Static text is markup, so `AT&amp;T` is the four characters `AT&T`
// wherever it is written — and a LIVE run's binding writes the whole run through `data`, which is
// not a parse, so the static piece has to go in decoded or the entity lands on the screen as its
// own bytes the first time the binding runs. The compiler decodes the piece by the text rule
// (`decodeCharacterReferences`), the same one a built row's text takes, which is what keeps a
// painted run and a written one the same text.
//
// THE REVERT: push the static piece's bytes as they stand (`JSON.stringify(node.text)`) into the
// live run's text branch in `emitClient`, rather than decoded. This reports `AT&amp;T 0` at mount and `AT&amp;T 1` after
// the click, where `AT&T 0` and `AT&T 1` are due.
test('a live run writes its static entities as the characters they stand for — 32.28', async () => {
    const { mount } = await mountPage(`<script>
import { reactive } from 'abide'

let count = reactive(0)
</script>

<p id="out">AT&amp;T {count}</p>
<button onclick={() => count = count + 1}>more</button>`)
    mount(pageRegion(document.body))
    flushSync()
    const out = document.querySelector('#out') as HTMLElement
    expect(out.textContent).toBe('AT&T 0')
    ;(document.querySelector('button') as HTMLElement).click()
    flushSync()
    expect(out.textContent).toBe('AT&T 1')
})

// 32.28 IN AN ATTRIBUTE THAT ALSO HOLDS A SLOT. The static text around a slot is the author's markup
// exactly as it is in an attribute with none — `AT&amp;T` is `AT&T` — and only the slot is data.
// Taken as one string, the whole value was escaped on the server (`AT&amp;amp;T`) and set as its
// own bytes by the client, so `title="AT&amp;T {n}"` showed `AT&amp;T 0` on both, while a bare `&`
// happened to come out right on both and hid it. A URL attribute is the exception 32.29 already
// makes: its static text is escaped the way a slot is, so `&amp;` stays those five characters.
//
// DECODED BY THE BUILD, and the value is data whole after that: the parser turns each static piece
// into the characters it stands for (`decodeCharacterReferences`), the server escapes the whole
// value as it would `{expr}`, and every way the client writes one sets it as it stands — the binding
// that keeps a live attribute moving, a row the browser builds (`title`, which reads only the row),
// and a live attribute on that built row (`data-live`). And the mount writes NOTHING: the value is
// what the browser already made of the server's bytes, so hydration compares equal.
//
// `Q&{slotted}` IS THE BOUNDARY, and it holds by construction. A static `&` that ended right before
// a slot once took the slot's `#38;` as the rest of a reference in the served bytes, and the page
// showed `Q&` where the data said `Q&#38;`; with the static text decoded and the whole value
// escaped, the slot's `&` is written `&amp;` like any other.
//
// THE REVERT: decode only a component's prop in `pushQuoted` (`interpolated(raw, prop)`), so an
// element's static pieces reach the escape as the author's bytes: the server writes
// `title="AT&amp;amp;T 0"` and the first assertion reports it.
test('the static text of an interpolated attribute is markup, and its slots are data — 32.28, 32.29', async () => {
    const { html, mount } = await mountPage(`<script>
import { reactive } from 'abide'

let n = reactive(0)
let rows = reactive([1])
const slotted = '#38;'
</script>

<main><p id="named" title="AT&amp;T {n}">a</p><p id="bare" title="AT&T {n}">b</p><p id="numeric" title="AT&#38;T {n}">c</p><p id="joined" title="Q&{slotted}">j</p><a id="url" href="/q?x=1&amp;y={n}">u</a><p id="merged" class="a&amp;b {n}" class:on={n}>m</p><button id="go" onclick={() => { n = n + 1; rows = [...rows, rows.length + 1] }}>go</button><ul>{#for row of rows by row}<li id={'r' + row} title="AT&amp;T {row}" data-live="AT&amp;T {n}">r</li>{/for}</ul></main>`)

    expect(html).toContain('<p id="named" title="AT&amp;T 0">')
    expect(html).toContain('<p id="bare" title="AT&amp;T 0">')
    expect(html).toContain('<p id="numeric" title="AT&amp;T 0">')
    expect(html).toContain('<p id="joined" title="Q&amp;#38;">')
    expect(html).toContain('<a id="url" href="/q?x=1&amp;amp;y=0">')

    const title = (id: string, name = 'title') =>
        document.querySelector(`#${id}`)?.getAttribute(name)
    expect(title('named')).toBe('AT&T 0')
    expect(title('bare')).toBe('AT&T 0')
    expect(title('numeric')).toBe('AT&T 0')
    expect(title('joined')).toBe('Q&#38;')
    expect(title('url', 'href')).toBe('/q?x=1&amp;y=0')
    expect(document.querySelector('#merged')?.classList.contains('a&b')).toBe(
        true,
    )
    expect(title('r1')).toBe('AT&T 1')

    const mountWork = measure(() => {
        mount(pageRegion(document.body))
        flushSync()
    })
    expect(mountWork.attributesSet).toBe(0)

    ;(document.querySelector('#go') as HTMLElement).click()
    flushSync()
    expect(title('named')).toBe('AT&T 1')
    expect(title('bare')).toBe('AT&T 1')
    expect(title('numeric')).toBe('AT&T 1')
    expect(title('url', 'href')).toBe('/q?x=1&amp;y=1')
    expect(title('r2')).toBe('AT&T 2')
    expect(title('r1', 'data-live')).toBe('AT&T 1')
    expect(title('r2', 'data-live')).toBe('AT&T 1')
})

// A ROW THE BROWSER BUILDS READS ITS STATIC TEXT AS THE PARSER READ THE SERVER'S, under the rule the
// position takes. `&notin` is the edge the two rules draw: between two tags it is `¬` and then
// `in`, and in an attribute the `in` after it keeps the whole as written. The build decodes each
// static string once (`decodeCharacterReferences`), so the row the page grew and the row the server
// painted are compared field by field — text, a static attribute, an interpolated one.
//
// THE REVERTS: build a text piece by the attribute rule (`emitBuild`'s static text) — the grown row
// reads `&notin & 2|` where `¬in & 2|` is due. Hand a static attribute over as its bytes
// (`buildRender`'s `bytes` as `JSON.stringify(bytes)`) — the grown row's `data-s` reads
// `&notin;x &amp;notin` where `∉x &notin` is due.
test('a built row decodes static text by the text rule and an attribute by the attribute rule — 32.28', async () => {
    const { mount } = await mountPage(`<script>
import { reactive } from 'abide'

let rows = reactive([1])
</script>

<main><button id="go" onclick={() => { rows = [...rows, rows.length + 1] }}>go</button><ul>{#for row of rows by row}<li id={'r' + row} data-s="&notin;x &amp;notin" title="&notin &amp; {row}">&notin &amp; {row}|</li>{/for}</ul></main>`)
    const read = (id: string) => {
        const row = document.querySelector(`#${id}`) as Element
        return [
            row.textContent,
            row.getAttribute('data-s'),
            row.getAttribute('title'),
        ]
    }
    expect(read('r1')).toEqual(['¬in & 1|', '∉x &notin', '&notin & 1'])
    const mountWork = measure(() => {
        mount(pageRegion(document.body))
        flushSync()
    })
    expect(mountWork.attributesSet).toBe(0)
    ;(document.querySelector('#go') as HTMLElement).click()
    flushSync()
    expect(read('r2')).toEqual(['¬in & 2|', '∉x &notin', '&notin & 2'])
})
