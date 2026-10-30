// THE CLIENT HALF, END TO END. The server renders a document, the client mounts into the very
// nodes the server wrote, a real click runs a real handler, and the text the browser shows moves.
//
// The counts are the point rather than the text. A binding that produces the right string by
// rebuilding the subtree produces the right string, and CLAUDE.md's rule is that a correctness
// test cannot guard a "does less work" contract — so the gate is on nodes created and elements
// moved, both of which a naive re-render would raise and neither of which changes the output.

import { afterAll, expect, test } from 'bun:test'

import { measure } from '@abide/harness/abide'

import { emitClient, parseAbide } from '#compiler'
import { flushSync } from '#shared'

import { removeTemporaryModules } from './temporaryModule.ts'
import {
    clientOf,
    closeTyped,
    renderPage,
    TYPED_ROOT,
    typedSession,
} from './typed.ts'

afterAll(closeTyped)

const session = await typedSession()
afterAll(removeTemporaryModules)

const PAGE = `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
const label = 'clicks'
</script>

<p id="out">{label}: {count}</p>
<button onclick={() => count = count + 1}>more</button>`

test('a click runs the handler and the slot the server wrote is the slot that moves', async () => {
    const { html, mount } = await renderPage(PAGE)

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
        mount()
        flushSync()
    })
    // Two slots on this page, ONE of which reads a reactive value. THE REVERT: drop the
    // `Lowering.isLiveRun` check in `emitClient`; this reports `bindingRuns` 1 -> 2 and `wakes`
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

    // On the CLICK only the reactive slot may rerun. A static slot's binding, if one were
    // opened, would not show up here at all — which is exactly why the mount is measured above.
    expect(work.bindingRuns).toBe(1)
    expect(work.wakes).toBe(1)
})

// A RUN reading nothing reactive is written once by the server and never again. The page below
// has TWO runs — one static, one live — which is what makes the case distinguish: a page whose
// only run is live reports one binding whether the check is there or not. THE REVERT: drop
// `Lowering.isLiveRun` in `emitClient` and bind every run; this reports 2 bindings where 1 is due, and
// the mount gate below reports `bindingRuns` 2 where it reports 1.
test('a run that reads nothing reactive opens no binding', async () => {
    const source = `<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
const label = 'clicks'
</script>

<p id="static">{label}</p>
<p id="live">{count}</p>`

    const file = parseAbide(source)
    const names = await session.reads(`${TYPED_ROOT}src/index.abide`, file)
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

// A component nothing invokes and with nothing to hydrate emits no client module at all. A page
// always has one: a reader can navigate to it, and it fills its own region from that module (30.7).
test('a static component nothing invokes emits no client module', async () => {
    expect(await clientOf('<h1>static</h1>', [])).toBe('')
})

// 41.4 — A RENDER MUST CONTINUE PAST A VALUE STILL IN FLIGHT, and 32.23 is what the slot itself
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
test('a render continues past a value still in flight — 41.4, 32.23', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

const invoice = reactive(() => Promise.resolve({ number: 'INV-1' }))
</script>

<main><h1 id="static">Invoice</h1><strong id="slot">{invoice.number}</strong></main>`)

    // THE PAGE IS THERE. The static markup either side of the hole is what the old behavior
    // dropped, so asserting the hole alone would pass against a render that emitted nothing.
    expect(html).toContain('<h1 id="static">Invoice</h1>')
    expect(html).toContain('<strong id="slot">')
    expect(document.querySelector('#static')?.textContent).toBe('Invoice')
    // The hole: 32.23 leaves what it last rendered, and nothing has been rendered yet.
    expect(document.querySelector('#slot')?.textContent).toBe('')

    // AND IT FILLS. The client reruns the body (41.6), the value lands, and the binding writes
    // into a text node that was not in the document the server wrote — which is `blank`'s arm.
    mount()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
    expect(document.querySelector('#slot')?.textContent).toBe('INV-1')
})

// 41.4 THROUGH A BLOCK'S ONE EXPRESSION. A `{#for}` reads its subject once for the whole block
// (32.21), so an unlanded subject took the page down the same way a slot did — and the fallback
// needs no deciding, because 32.22 already says an absent subject iterates zero times and
// `listOf` already answers `[]` for absent. The abort just makes "in flight" reach it.
//
// TWO REVERTS, BECAUSE THE SERVER HALF ALONE IS THE WORSE BUG. Drop the `slotValue` wrapper from
// the `{#for}` arm of `emitNode` and `render` throws: no document, loudly. Drop `hydrate`'s
// `found.length === 0` bail instead and the document is served, the list is empty, and it stays
// empty for ever — the watch that would have hydrated the rows threw on the same subject, so
// `hydrating` was still set when the value landed and the rows were walked against nothing. This
// test reports [] against [north, south] either way, and only the second one looks fine on screen.
test('a render continues past a {#for} subject still in flight — 41.4, 32.22', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

const rows = reactive(() => Promise.resolve(['north', 'south']))
</script>

<main><h1 id="static">Regions</h1><ul id="list">{#for row of rows by row}<li>{row}</li>{/for}</ul></main>`)

    expect(html).toContain('<h1 id="static">Regions</h1>')
    // The block rendered its anchors and no rows, which is 32.22's zero times.
    expect(document.querySelectorAll('#list li')).toHaveLength(0)

    mount()
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
// value: 32.3's binding reruns on the value that landed and writes it into the attribute the
// server left empty, exactly as `blank` does for a text run. Before that binding existed the
// empty attribute was permanent, and the test below asserted it and called that the answer.
//
// EACH ABSENCE IS THE ONE ALREADY DECIDED WHERE IT LANDS — an attribute holding `undefined` is
// absent (32.37), and `escapeStyleValue` reads it as '' through `textOf`, so nothing new was decided
// to make this work.
//
// THE REVERT: make `unlandable` answer `lowered` unconditionally and `render` throws
// `NotLanded: reactive has not landed` — no document at all, on a page whose static markup is
// most of it. This test then reports nothing rendered rather than a page with two empty values.
test('a render continues past an unlanded attribute and style — 41.4', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

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
    mount()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(document.querySelector('#attr')?.getAttribute('title')).toBe('warm')
    expect((document.querySelector('#styled') as HTMLElement).style.width).toBe(
        '40px',
    )
})

// 32.37 — `disabled="false"` IS A DISABLED BUTTON. A whole-value attribute was written as its text,
// so `disabled={busy}` shipped every button disabled whatever `busy` held, and the docs' own cards
// were written around it. Presence is the answer for an attribute HTML reads by presence; text for
// every other, where `aria-busy="false"` means something its absence does not; and `undefined`
// is absent for all of them — on the server, in a binding, in a row the browser builds and through
// a spread alike.
//
// THE REVERT: skip the `BOOLEAN_ATTRIBUTES` arm of `attributeText`; the server then writes
// `disabled="false"` and `hidden="false"`, and the first assertion reports it.
test('a boolean attribute is present or absent, and any other is its text — 32.37', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

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

    mount()
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

// 32.37 — A STRING THAT MAKES A PRESENCE ATTRIBUTE PRESENT IS ITS TEXT. `hidden` is one, and
// `hidden="until-found"` is a real value: written bare, the content is hidden for good and a reader's
// find-in-page can no longer reveal it. THE REVERT: answer `''` for every truthy value in
// `attributeText`'s presence arm; the server writes a bare `hidden` and the binding does too.
test('a presence attribute given a string carries it — 32.37', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let found = reactive<string | boolean>('until-found')
</script>

<main><div id="d" hidden={found}>d</div><button id="f" onclick={() => (found = found === true ? 'until-found' : true)}>f</button></main>`)

    expect(html).toContain('<div id="d" hidden="until-found">')
    mount()
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
// SO THE ABORT EMPTIES THE REGION, and `isEmptyRegion` — 32.17's signal for a component whose row
// the browser grew — is what the block's first run reads to fill instead of hydrate. Nothing was
// added to the document to carry it.
//
// THE `{:else}` ARM IS WHAT MAKES THE CASE DISTINGUISH. Without it an aborted chain and a chain
// that took the false arm both render nothing, so the test passes against the bug; with it, the
// old behavior puts `off` in the document and leaves it there.
//
// TWO REVERTS. Drop the `slotValue` wrapper from the `{#if}` arm of `emitNode` and `render`
// throws `NotLanded` — no document at all. Drop the `isEmptyRegion` arm of the block's watch in
// `emitClient` instead and the document is served with an empty region that never fills.
test('a render continues past an {#if} subject still in flight — 41.4, 32.12', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

const shown = reactive(() => Promise.resolve(true))
</script>

<main><h1 id="static">Panel</h1>{#if shown}<span id="arm">on</span>{:else}<span id="off">off</span>{/if}</main>`)

    // THE PAGE IS THERE, and NEITHER ARM IS. The region carries its anchors and nothing between
    // them, which is the whole of what the client reads.
    expect(html).toContain('<h1 id="static">Panel</h1>')
    expect(html).not.toContain('id="arm"')
    expect(html).not.toContain('id="off"')

    mount()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    expect(document.querySelector('#arm')?.textContent).toBe('on')
    expect(document.querySelector('#off')).toBeNull()
})

// 41.24 — A REGION ADOPTS ONLY THE ARM THE SERVER PAINTED. The two sides disagree here for a reason no
// wait can help with — a value that is one thing where the page rendered and another where it
// hydrates — and both arms are one `<button>` apiece, so no walk refuses (41.10) and adopting would
// bind the client's handler to the server's button in silence. The button's TEXT is static, so it
// is whose nodes stand that this reads, apart from whose handler runs.
//
// THE REVERT: answer `false` from `ArmRegion.paintedOther`. This reports the button reading
// `server` with the click running `client`, and no warning where one is due.
test('an arm the client chose apart from the painted one is filled, not adopted — 41.24', async () => {
    const side = globalThis as { armSide?: string | undefined }
    side.armSide = 'server'
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let pressed = reactive('')
const side = (globalThis as { armSide?: string }).armSide
</script>

<main>{#if side === 'server'}<button id="act" onclick={() => { pressed = 'server' }}>server</button>{:else}<button id="act" onclick={() => { pressed = 'client' }}>client</button>{/if}<p id="pressed">{pressed}</p></main>`)
    expect(html).toContain('<!--[0--><button id="act">server</button><!--]-->')

    side.armSide = 'client'
    let warned: string[]
    try {
        warned = hydrateWarnings(() => {
            mount()
            flushSync()
        })
    } finally {
        side.armSide = undefined
    }
    const button = document.querySelector('#act') as HTMLElement
    button.click()
    flushSync()
    expect({
        shown: button.textContent,
        pressed: document.querySelector('#pressed')?.textContent,
        warnings: warned.length,
    }).toEqual({ shown: 'client', pressed: 'client', warnings: 1 })
})

// THE SAME ARM ON BOTH SIDES IS ADOPTED, not refilled: the check costs the hydrating page a compare
// and nothing else. THE REVERT: answer `true` from `paintedOther`; this reports `nodesCreated` 2
// where 0 is due.
test('an arm the client chose as the server did is adopted — 41.24', async () => {
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let on = reactive(false)
</script>

<main>{#if on}<b>on</b>{:else}<i>off</i>{/if}<button id="flip" onclick={() => { on = !on }}>flip</button></main>`)
    let work: ReturnType<typeof measure> | undefined
    const warned = hydrateWarnings(() => {
        work = measure(() => {
            mount()
            flushSync()
        })
    })
    expect(work?.nodesCreated).toBe(0)
    expect(warned).toEqual([])
    ;(document.querySelector('#flip') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('b')?.textContent).toBe('on')
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
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

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
        mount()
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
    // it reports 0, because hydration reruns every binding on a value that has not moved.
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
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let late = reactive(false)
</script>

<main><p id="out" class="badge" class:overdue={late}>x</p>
<button id="go" onclick={() => { late = true }}>go</button></main>`)

    // ONE `class` ATTRIBUTE ON THE TAG, holding what the condition said at render — which is the
    // page being right with no JS at all.
    expect(html).toContain('class="badge"')
    expect(html).not.toContain('overdue')

    mount()
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

// 32.71 — A `class` THAT MOVES, BESIDE A `class:name`, KEEPS MOVING, and a class either half holds
// stays. The server merged both into one attribute, so the page was right at render and froze on
// the first change of `tone`: the attribute was left unbound because writing it back whole would
// have taken the directive's class with it.
//
// THE REVERT: make `sharedGroupOf` answer `undefined`. `tone` then never moves — this reports
// `badge calm overdue` where `badge loud overdue` is due — and `a` comes off with `flag` while
// `tags` still holds it.
test('a class beside a class: directive keeps moving, and a class either holds stays — 32.71', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let tone = reactive('calm')
let late = reactive(true)
let tags = reactive('a b')
let flag = reactive(true)
</script>

<main><p id="out" class="badge {tone}" class:overdue={late}>x</p>
<p id="held" class={tags} class:a={flag}>y</p>
<button id="tone" onclick={() => { tone = 'loud' }}>tone</button>
<button id="unflag" onclick={() => { flag = false }}>unflag</button>
<button id="untag" onclick={() => { tags = 'b' }}>untag</button>
<button id="flag" onclick={() => { flag = true }}>flag</button>
<button id="retag" onclick={() => { tags = 'a' }}>retag</button></main>`)

    expect(html).toContain('class="badge calm overdue"')

    const sorted = (id: string) =>
        [...(document.querySelector(`#${id}`) as HTMLElement).classList]
            .sort()
            .join(' ')
    const click = (id: string) => {
        ;(document.querySelector(`#${id}`) as HTMLElement).click()
        flushSync()
    }

    // THE FIRST RUN OVER A SERVED PAGE WRITES NO CLASS: every token is there already.
    const mountWork = measure(() => {
        mount()
        flushSync()
    })
    expect(mountWork.attributesSet).toBe(0)
    expect(mountWork.classWrites).toBe(0)
    expect(sorted('out')).toBe('badge calm overdue')

    // ONE TOKEN OUT AND ONE IN, through the class list — never the attribute.
    const toneWork = measure(() => click('tone'))
    expect(sorted('out')).toBe('badge loud overdue')
    expect(toneWork.classWrites).toBe(2)
    expect(toneWork.attributesSet).toBe(0)

    expect(sorted('held')).toBe('a b')
    click('unflag')
    expect(sorted('held')).toBe('a b')
    click('untag')
    expect(sorted('held')).toBe('b')
    click('flag')
    expect(sorted('held')).toBe('a b')
    click('retag')
    expect(sorted('held')).toBe('a')
    click('unflag')
    expect(sorted('held')).toBe('a')
})

// 32.71 IN A ROW, where the writes come from two places: the row's mount, and its `update` when
// the same key takes a new item (32.67) — a function of its own, which is why who holds which
// class is kept on the element rather than in the mount. And a row the browser BUILDS starts from
// the merged value the server would have written.
//
// THE REVERT: make `sharedGroupOf` answer `undefined`; the directive's first run takes the row's own `hot`
// off, and this reports `calm on row` where `calm hot on row` is due.
test('a class beside a class: directive moves with its row — 32.71', async () => {
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let hot = reactive(false)
let rows = reactive([{ id: 'a', tone: 'calm hot', on: true }])
</script>

<main><ul>{#for row of rows by row.id}<li id={row.id} class="row {row.tone}" class:on={row.on} class:hot={hot}>x</li>{/for}</ul>
<button id="move" onclick={() => { rows = [{ id: 'a', tone: 'loud', on: false }, { id: 'b', tone: 'calm', on: true }] }}>move</button>
<button id="heat" onclick={() => { hot = true }}>heat</button>
<button id="cool" onclick={() => { hot = false }}>cool</button></main>`)

    mount()
    flushSync()
    const sorted = (id: string) =>
        [...(document.querySelector(`#${id}`) as HTMLElement).classList]
            .sort()
            .join(' ')
    const click = (id: string) => {
        ;(document.querySelector(`#${id}`) as HTMLElement).click()
        flushSync()
    }

    // `hot` is the row's own class, so the directive's first run, off, leaves it.
    expect(sorted('a')).toBe('calm hot on row')
    click('move')
    expect(sorted('a')).toBe('loud row')
    expect(sorted('b')).toBe('calm on row')
    click('heat')
    expect(sorted('a')).toBe('hot loud row')
    expect(sorted('b')).toBe('calm hot on row')
    click('cool')
    expect(sorted('a')).toBe('loud row')
    expect(sorted('b')).toBe('calm on row')
})

// 32.71 — A SHARED GROUP IS ONE WRITER, at mount and in a row's `update`: it diffs the whole
// class list it wrote against the one it writes now, so a class moving from the directive to the
// attribute moves nothing. The output is the same either way, which is why the work is asserted.
//
// THE REVERT is structural — a writer per member, the tokens and each directive apart, each
// keeping a record of what the other holds. That design reported 2 class writes at mount and 1
// in the `update`, where 0 and 0 are due: a directive's toggle runs whether or not it moves the
// class, and one turning off while the attribute takes the class over writes it.
test('a shared class group is one writer — 32.71', async () => {
    const mounted = await renderPage(`<script>
import { reactive } from '@abide/abide'

let tone = reactive('calm')
let rows = reactive([{ id: 'a', on: reactive(false) }, { id: 'b', on: reactive(true) }])
</script>

<main><ul>{#for row of rows by row.id}<li id={row.id} class="row active {tone}" class:active={row.on()}>x</li>{/for}</ul></main>`)
    const mountWork = measure(() => {
        mounted.mount()
        flushSync()
    })
    // The tokens are all there already.
    expect(mountWork.classWrites).toBe(0)
    expect(document.querySelector('#a')?.className).toContain('active')

    const updated = await renderPage(`<script>
import { reactive } from '@abide/abide'

let rows = reactive([{ id: 'a', sel: true, cls: 'a' }])
</script>

<main><ul>{#for row of rows by row.id}<li id={row.id} class:sel={row.sel} class={row.cls}>x</li>{/for}</ul>
<button id="swap" onclick={() => { rows = [{ id: 'a', sel: false, cls: 'a sel' }] }}>swap</button></main>`)
    updated.mount()
    flushSync()
    const updateWork = measure(() => {
        ;(document.querySelector('#swap') as HTMLElement).click()
        flushSync()
    })
    expect(document.querySelector('#a')?.className).toBe('a sel')
    expect(updateWork.classWrites).toBe(0)
})

// 32.71 — A LIVE GROUP'S WATCH IS THE ROW'S ONE WRITER OF IT, even where a member reads the item
// without being live: the watch reads the item through the row's cell, so a new item reruns it,
// and the row's `update` has nothing left to write.
//
// THE REVERT: drop `if (one.live) continue` from the group's arm of `rowUpdate`, and every row
// writes its group twice — this reports 4 binding runs where 2 are due.
test("a live class group is not written again by its row's update — 32.71", async () => {
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let hot = reactive(false)
let rows = reactive([{ id: 'a', tone: 'calm' }, { id: 'b', tone: 'calm' }])
</script>

<main><ul>{#for row of rows by row.id}<li class="row {row.tone}" class:hot={hot}>x</li>{/for}</ul>
<button id="retone" onclick={() => { rows = rows.map((row) => ({ ...row, tone: 'loud' })) }}>retone</button></main>`)
    mount()
    flushSync()
    const work = measure(() => {
        ;(document.querySelector('#retone') as HTMLElement).click()
        flushSync()
    })
    expect(
        [...document.querySelectorAll('li')].map((li) => li.className),
    ).toEqual(['row loud', 'row loud'])
    expect(work.bindingRuns).toBe(2)
})

// 32.71 — A `style` THAT MOVES, BESIDE A `style:prop`, KEEPS MOVING, and a property either half
// declares stays. The server merged both into one attribute, so the page was right at render and
// froze on the first change of `look`: the attribute was left unbound because writing it back
// whole would have taken the directive's property with it.
//
// THE REVERT: make `sharingOf` answer `undefined` for a `style` group. `look` then never moves —
// this reports `red` where `blue` is due.
test('a style beside a style: property keeps moving, and a property either holds stays — 32.71', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let look = reactive('color: red')
let wide = reactive('10px')
</script>

<main><p id="out" style={look} style:width={wide}>x</p>
<button id="blue" onclick={() => { look = 'color: blue; margin: 1px 2px' }}>blue</button>
<button id="bare" onclick={() => { look = '' }}>bare</button>
<button id="claim" onclick={() => { look = 'width: 5px' }}>claim</button>
<button id="narrow" onclick={() => { wide = '' }}>narrow</button></main>`)

    expect(html).toContain('style="color: red; ; width: 10px"')
    const style = () => (document.querySelector('#out') as HTMLElement).style
    const click = (id: string) => {
        ;(document.querySelector(`#${id}`) as HTMLElement).click()
        flushSync()
    }

    // THE FIRST RUN OVER A SERVED PAGE WRITES NOTHING: every declaration is there already.
    const mountWork = measure(() => {
        mount()
        flushSync()
    })
    expect(mountWork.attributesSet).toBe(0)
    expect(mountWork.styleWrites).toBe(0)

    click('blue')
    expect(style().color).toBe('blue')
    expect(style().marginLeft).toBe('2px')
    expect(style().width).toBe('10px')
    // WHAT THE ATTRIBUTE DROPS COMES OFF; the directive's property stays.
    click('bare')
    expect(style().color).toBe('')
    expect(style().marginTop).toBe('')
    expect(style().width).toBe('10px')
    // BOTH DECLARE `width`: the directive's comes later in the merged list, as on the server, and
    // when it is emptied the attribute's still stands.
    click('claim')
    expect(style().width).toBe('10px')
    click('narrow')
    expect(style().width).toBe('5px')
})

// 32.71 — THE GROUP RESOLVES AS THE SERVER'S MERGED LIST DOES, a shorthand on one side and a
// longhand on the other included: the attribute's declarations first, each directive's after
// them, and a directive with no value declaring nothing.
//
// THE REVERT: drop the `lay` that follows an emptied directive in `setStyleGroup`. Emptying
// `style:margin` then takes the attribute's `margin-top` off with it — this reports `''` where
// `1px` is due.
test('a style group resolves a shorthand beside a longhand as the server does — 32.71', async () => {
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let look = reactive('margin-top: 1px; color: red !important')
let gap = reactive('4px')
</script>

<main><p id="out" style={look} style:margin={gap}>x</p>
<button id="empty" onclick={() => { gap = '' }}>empty</button>
<button id="wide" onclick={() => { gap = '6px' }}>wide</button>
<button id="left" onclick={() => { look = 'margin-left: 9px' }}>left</button></main>`)
    mount()
    flushSync()
    const style = () => (document.querySelector('#out') as HTMLElement).style
    const click = (id: string) => {
        ;(document.querySelector(`#${id}`) as HTMLElement).click()
        flushSync()
    }

    expect(style().marginTop).toBe('4px')
    expect(style().getPropertyPriority('color')).toBe('important')
    click('empty')
    expect(style().marginTop).toBe('1px')
    expect(style().marginLeft).toBe('')
    click('wide')
    expect(style().marginTop).toBe('6px')
    // THE DIRECTIVE COMES LATER, so the attribute's new longhand does not win over it.
    click('left')
    expect(style().marginLeft).toBe('6px')
    expect(style().color).toBe('')
    click('empty')
    expect(style().marginLeft).toBe('9px')
    expect(style().marginTop).toBe('')
})

// 31.3 — AN `await` OPERAND HOLDS THE `Reactive`, WHEREVER AN `await` IS LEGAL. Every `Reactive`
// is a promise for its own settling (1.4, 2.7), so this is the same line a `.ts` file writes and
// it means the same thing. Lowered as a read (31.1) it would be `await total()` — what has landed,
// and a throw where nothing has (2.9), which is never what an `await` asked for.
//
// IN A HANDLER, BECAUSE 34.3 IS WHY. Setup is a function body on both sides and may not await at
// its top level, so the positions left are the ones inside a function — a handler, a `reactive`
// body — and a handler is the one a test can drive.
//
// THE REVERT: drop the `AwaitExpression` arm of `classifyRead`. The click then runs
// `await total()` on a value that has not landed and the handler throws `NotLanded` instead of
// moving the text to 42 — this reports `waiting`.
test('an await operand holds the Reactive — 31.3', async () => {
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

const total = reactive(async () => {
    await Bun.sleep(20)
    return 42
})
let shown = reactive('waiting')
</script>

<p id="out">{shown}</p>
<button id="go" onclick={async () => {
    try {
        shown = String(await total)
    } finally {
        ;(globalThis as { __handled?: () => void }).__handled?.()
    }
}}>go</button>`)

    mount()
    // The handler says when it is done, rather than the test guessing how long `total` takes.
    const handled = new Promise<void>((resolve) => {
        ;(globalThis as { __handled?: () => void }).__handled = resolve
    })
    ;(document.querySelector('#go') as HTMLElement).click()
    await handled
    flushSync()
    expect(document.querySelector('#out')?.textContent).toBe('42')
})

// 34.3 — A SCRIPT BLOCK MAY NOT AWAIT AT ITS TOP LEVEL, and the compiler says so. Setup is a
// function body on both sides, so nothing holds the render: every value a page reads is a hole the
// document is written around (41.4, 32.23).
//
// BOTH BLOCKS, for two reasons. A `<script>` is a function body on both sides, where the line does
// not parse. A `<script module>` is module scope (34.2), where it does — and holds the import of
// every file that reaches it until it settles, which is the render waiting in all but name.
//
// THE REVERT: drop the two `refuseTopLevelAwait` calls in `projectShadow`. The `<script>` row
// reports a bundler error against a file the author never wrote, and the `<script module>` row
// renders with nothing refused.
test('a script block cannot await at its top level — 34.3', async () => {
    for (const block of ['<script>', '<script module>']) {
        let thrown = ''
        try {
            await renderPage(`${block}
const rows = await Promise.resolve(1)
</script>

<p id="out">{rows}</p>`)
        } catch (error) {
            thrown = String(error)
        }
        expect(thrown).toContain(`a ${block} cannot await at its top level`)
    }
})

// 34.17 — A `.abide` CANNOT EXPORT, IN ANY BLOCK: its component is its one export. A `<script>` runs
// once per instance, so no one instance is there for an importer to read; a `<script module>`'s or
// a `<script server>`'s export would be a second public face beside the handler files and lib
// modules that already are one. Every spelling, `export default` and a re-export among them.
//
// THE REVERT: drop the three `refuseExport` calls in `projectShadow`; each row then compiles, or
// fails in the bundler or at the missing `./elsewhere.ts`, naming neither the page nor the clause —
// 0 of the 12 citing 34.17, against 12.
test('an export in any script block is a compile error — 34.17', async () => {
    const cited: string[] = []
    for (const block of ['<script>', '<script module>', '<script server>'])
        for (const spelled of [
            'export const rows = 1',
            'const rows = 1\nexport { rows }',
            'export default 1',
            "export * from './elsewhere.ts'",
        ]) {
            let thrown = ''
            try {
                await renderPage(`${block}
${spelled}
</script>

<p id="out">one</p>`)
            } catch (error) {
                thrown = String(error)
            }
            if (thrown.includes('RULEBOOK 34.17'))
                cited.push(`${block} ${spelled}`)
        }
    expect(cited).toHaveLength(12)
})

// 32.57 — A TEMPLATE EXPRESSION CANNOT AWAIT EITHER, and for its own reason: each is lowered into
// an ordinary arrow inside the markup concatenation, so there is no function for an `await` to
// belong to at all. Apart from 34.3 because the refusal is the checker's walk of the template
// expressions rather than the projection's, and an expression has no top level to speak of.
//
// THE REVERT: drop the `await` throw from `expressionFacts`. The compile succeeds and the
// import of the emitted module reports the same bundler error, naming neither the page nor the
// slot.
test('a template position cannot await', async () => {
    let thrown = ''
    try {
        await renderPage(`<script>
import { reactive } from '@abide/abide'

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
// THE REVERT: drop the `FUNCTIONS` arm of `expressionFacts`. This reports
// `a template position cannot await` against a page that is entirely correct.
test('a slot that declares its own async may await in it', async () => {
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let shown = reactive('idle')
const later = async () => 'done'
</script>

<p id="out">{shown}</p>
<button id="go" onclick={async () => { shown = await later() }}>go</button>`)

    mount()
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
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

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

    mount()
    flushSync()

    // THE BINDING AFTER THE REFUSAL IS LIVE.
    ;(document.querySelector('#go') as HTMLElement).click()
    flushSync()
    expect(document.querySelector('#two')?.textContent).toBe('bB2')
    // And so is the listener, which stands in a later unit again.
    expect(document.querySelector('#one')?.textContent).toBe('aA')
})

// 32.27 IN A RUN THAT MOVES. Static text is markup, so `AT&amp;T` is the four characters `AT&T`
// wherever it is written — and a LIVE run's binding writes the whole run through `data`, which is
// not a parse, so the static piece has to go in decoded or the entity lands on the screen as its
// own bytes the first time the binding runs. The compiler decodes the piece by the text rule
// (`decodeCharacterReferences`), the same one a built row's text takes, which is what keeps a
// painted run and a written one the same text.
//
// THE REVERT: push the static piece's bytes as they stand (`JSON.stringify(node.text)`) into the
// live run's text branch in `emitClient`, rather than decoded. This reports `AT&amp;T 0` at mount and `AT&amp;T 1` after
// the click, where `AT&T 0` and `AT&T 1` are due.
test('a live run writes its static entities as the characters they stand for — 32.27', async () => {
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let count = reactive(0)
</script>

<p id="out">AT&amp;T {count}</p>
<button onclick={() => count = count + 1}>more</button>`)
    mount()
    flushSync()
    const out = document.querySelector('#out') as HTMLElement
    expect(out.textContent).toBe('AT&T 0')
    ;(document.querySelector('button') as HTMLElement).click()
    flushSync()
    expect(out.textContent).toBe('AT&T 1')
})

// 32.27 IN AN ATTRIBUTE THAT ALSO HOLDS A SLOT. The static text around a slot is the author's markup
// exactly as it is in an attribute with none — `AT&amp;T` is `AT&T` — and only the slot is data.
// Taken as one string, the whole value was escaped on the server (`AT&amp;amp;T`) and set as its
// own bytes by the client, so `title="AT&amp;T {n}"` showed `AT&amp;T 0` on both, while a bare `&`
// happened to come out right on both and hid it. A URL attribute is the exception 32.28 already
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
test('the static text of an interpolated attribute is markup, and its slots are data — 32.27, 32.28', async () => {
    const { html, mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

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
        mount()
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
test('a built row decodes static text by the text rule and an attribute by the attribute rule — 32.27', async () => {
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

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
        mount()
        flushSync()
    })
    expect(mountWork.attributesSet).toBe(0)
    ;(document.querySelector('#go') as HTMLElement).click()
    flushSync()
    expect(read('r2')).toEqual(['¬in & 2|', '∉x &notin', '&notin & 2'])
})

// 41.10 — THE KIND CHECK READS THE TAG THE PARSER WROTE, and inside an `<svg>` the parser gives
// back SVG's camelCase: a `<textPath>` stands as `textPath`, so that is the tag the compiler emits
// (`SVG_CASE`). Asking for the folded `textpath` refused the arm's whole mount, and an `{#if}`
// inside the arm kept what the server painted forever.
//
// THE REVERT: emit `node.lowerTag` from `Cursor.element`. This logs `expected <textpath>`, leaves
// the href at `#a` and reports the circle still standing.
test('an element SVG spells in camelCase hydrates, and an {#if} past it swaps — 41.10', async () => {
    const { mount } = await renderPage(`<script>
import { reactive } from '@abide/abide'

let on = reactive(true)
let label = reactive('a')
</script>

<main>{#if label}<svg><text><textPath href="#{label}">a</textPath></text>{#if on}<circle id="dot" r="2" />{/if}</svg>{/if}<button id="flip" onclick={() => { on = !on }}>flip</button><button id="relabel" onclick={() => { label = 'b' }}>relabel</button></main>`)
    const warned = hydrateWarnings(() => {
        mount()
        flushSync()
        expect(document.querySelector('#dot')?.localName).toBe('circle')
        ;(document.querySelector('#relabel') as HTMLElement).click()
        flushSync()
        ;(document.querySelector('#flip') as HTMLElement).click()
        flushSync()
    })
    expect({
        href: document.querySelector('textPath')?.getAttribute('href'),
        dot: document.querySelector('#dot')?.localName,
        warned,
    }).toEqual({ href: '#b', dot: undefined, warned: [] })
})

/** The `abide:hydrate` warnings `body` logs, with `console.warn` restored however it ends. */
function hydrateWarnings(body: () => void): string[] {
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '))
    try {
        body()
    } finally {
        console.warn = warn
    }
    return warned.filter((line) => line.includes('abide:hydrate'))
}
