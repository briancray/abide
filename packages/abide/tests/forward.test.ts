// FORWARD PRESSURE — the smallest case for a clause that is NOT BUILT YET, written to find out
// whether what is built can grow into it, while the answer is still cheap.
//
// It has said AWAY once already and been rewritten for it: slots were addressed by their position
// in document order over the whole page, an `{#if}` false branch shifted every one after it, and
// mounting into such a page threw. The scheme now addresses a node by CHILD INDICES from its
// region root and adds nothing to the document at all.
//
// WHAT THAT BUYS is below. WHAT IT DOES NOT is the last test: a region whose shape depends on a
// value still moves the indices of its siblings, so 32.13 and 32.14 need an ANCHOR in the
// document at the boundary — which is exactly where a marker earns its place, and the only place
// it does.

import { afterAll, expect, test } from 'bun:test'
import { parseAbide, planTemplate } from '#compiler'
import { elementAt, textAt } from '#ui'
import { removeTemporaryModules } from './temporaryModule.ts'
import { clientOf, closeTyped } from './typed.ts'

afterAll(closeTyped)

afterAll(removeTemporaryModules)

const SOURCE = `<script>
import { reactive } from 'abide'
let a = reactive('A')
let b = reactive('B')
</script>
<p id="one">{a}</p>
<div><span>{b} tail</span><button onclick={() => a = 'x'}>go</button></div>`

// THE PROPERTY A STATIC REGION NEEDS. A path is exact, and nothing was added to the document to
// make it so. THE REVERT: drop the `childIndex` increment for a text run in `planTemplate` so
// runs and elements share a counter; `[1,0,0]` then addresses the `<button>` rather than the
// `<span>`'s text, and this reports a BUTTON where a text node is due.
test('a node is found by child index from the region root', () => {
    document.body.innerHTML =
        '<p id="one">A</p><div><span>B tail</span><button>go</button></div>'

    expect(textAt(document.body, [0, 0]).data).toBe('A')
    expect(textAt(document.body, [1, 0, 0]).data).toBe('B tail')
    expect(elementAt(document.body, [1, 1]).nodeName).toBe('BUTTON')
})

// A TEXT RUN IS ONE NODE, which is what lets this scheme exist at all: `{b} tail` merges into a
// single text node when parsed, so there is nothing to address separately and nothing to invent.
test('a run of static text and expressions plans as one node', () => {
    const plan = planTemplate(parseAbide(SOURCE).template)
    expect(plan.runs).toHaveLength(2)
    expect(plan.runs[1]?.path).toEqual([1, 0, 0])
    expect(plan.runs[1]?.parts).toMatchObject([
        { text: 'b' },
        { text: ' tail', holder: null },
    ])
    expect(plan.handlers[0]?.path).toEqual([1, 1])
})

// 41.11 — addressing by position is SILENT when it is wrong, so the kind is checked. THE REVERT:
// return the node without the `nodeType` test; the binding then writes `data` onto an ELEMENT,
// which is a no-op that leaves the page rendering the server's values forever with nothing said.
test('a binding that finds the wrong kind of node says so', () => {
    document.body.innerHTML = '<p id="one">A</p><div><span>B</span></div>'
    expect(() => textAt(document.body, [1])).toThrow('41.11')
    expect(() => textAt(document.body, [1])).toThrow('DIV')
    expect(() => elementAt(document.body, [0, 0])).toThrow('41.11')
})

test('the emitted binding walks a path and adds nothing to the document', async () => {
    const client = await clientOf(SOURCE, ['a', 'b'])
    // The `<span>`'s text and the `<button>` both sit under the `<div>` at [1], so that walk is
    // taken once and both reference it. The `<p>` at [0] has no company and walks alone.
    //
    // DECLARED APART FROM ITS ASSIGNMENT, because the page guards each binding on its own (41.11,
    // `emitClient`) and an anchor is the one name that crosses from one guard into the next.
    expect(client).toContain('let at0')
    expect(client).toContain('at0 = __childAt(root, [1])')
    // `{b} tail` carries a static piece, so it always renders a node. `{a}` is every part an
    // expression and can render none, which is the `true` — `textAt` puts one back.
    expect(client).toContain('__textAt(at0, [0,0])')
    expect(client).toContain('__elementAt(at0, [1])')
    expect(client).toContain('__textAt(root, [0,0], true)')
    expect(client).not.toContain('data-a')
    expect(client).not.toContain('slots(')
    // RESOLVED ONCE AT MOUNT, and the binding writes the node it holds. THE REVERT: emit
    // `setText(<address>, …)` inside the watch; every write then re-walks its path — 0.47 µs a
    // write against 0.22 in Chromium, the walk being 0.21 of it.
    expect(client).toContain('const __t1_0_0 = __textAt(at0, [0,0])')
    expect(client).toContain('__setText(__t1_0_0,')
    expect(client).not.toContain('__setText(__textAt(')
})

// STILL NOT BUILT, and the next thing forward pressure is owed. A region whose shape depends on a
// value shifts the child indices of everything after it, so `{#if}` and `{#for}` cannot address
// their siblings by position alone — the boundary needs an ANCHOR the document keeps whether the
// region rendered or not. That is the one place a marker is worth its bytes, and this records the
// requirement rather than the solution.
test('a region that may not render moves its siblings — 32.13 and 32.14 need an anchor', () => {
    document.body.innerHTML = '<p>before</p><p>after</p>'
    expect(textAt(document.body, [1, 0]).data).toBe('after')

    // The same page with a conditional region absent between them. Nothing marks where it was.
    document.body.innerHTML = '<p>before</p>'
    expect(() => textAt(document.body, [1, 0])).toThrow('41.11')
})

// THE WALK IS SHARED WHERE IT CAN BE. Four bindings under one parent walk the parent once, not
// four times — measured at 2.3x a marker walk on a wide tree when every binding walked alone
// (`depth.spec.ts`), and the compiler holds every path so the sharing is free to compute.
//
// THE REVERT: return `{ base: 'root', rest: path }` from `hoistPaths`' `reference` and emit no
// anchors; every binding then walks its whole path, which this reports as 0 `childAt` lines where
// 1 is due and four full paths where four one-step ones are.
test('bindings under one parent share the walk to it', async () => {
    const source = `<script>
import { reactive } from 'abide'
let a = reactive(1)
let b = reactive(2)
let c = reactive(3)
</script>
<section><div><p>{a}</p><p>{b}</p><p>{c}</p></div></section>`

    const client = await clientOf(source, ['a', 'b', 'c'])
    // One anchor down to the shared `<div>`, then a step per binding.
    expect(client.match(/childAt\(/g) ?? []).toHaveLength(1)
    expect(client).toContain('__childAt(root, [0,0])')
    expect(client).toContain('__textAt(at0, [0,0], true)')
    expect(client).toContain('__textAt(at0, [1,0], true)')
    expect(client).toContain('__textAt(at0, [2,0], true)')
})
