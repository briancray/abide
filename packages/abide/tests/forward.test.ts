// THE STATIC REGION, ADDRESSED — what a binding is found by when nothing in the document marks it.
//
// Twice this file said AWAY and the scheme was rewritten for it: slots were addressed by their
// position in document order over the whole page, and an `{#if}` false branch shifted every one
// after it; then they were addressed by child indices from the region root, and a region's value-
// dependent length shifted every index after IT, which is what the anchors were added for. Now a
// binding's node is found by the walk that wrote the markup (`Cursor`): each node from the one
// before it or the one it stands in, and past a region from its closing anchor. Nothing is added
// to the document but those anchors.

import { afterAll, expect, test } from 'bun:test'
import { elementHere, regionFound, regionHere, textHere } from '#ui'
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

// 41.10 — A WALK BY POSITION IS SILENT WHEN IT IS WRONG, so every unit checks the KIND of the node
// it was handed. THE REVERT: return the node without the `nodeType` test in `elementHere`; a
// listener is then added to a TEXT node, which accepts it and never fires, and the page renders
// the server's markup forever with nothing said.
test('a unit that is handed the wrong kind of node says so', () => {
    document.body.innerHTML = '<p id="one">A</p><div><span>B</span></div>'
    const p = document.body.firstChild as Node
    const div = p.nextSibling as Node
    expect((textHere(p.firstChild) as Text).data).toBe('A')
    expect(() => textHere(div)).toThrow('41.10')
    expect(() => elementHere(p.firstChild, 'p')).toThrow('41.10')
    expect(() => elementHere(div, 'p')).toThrow('<p>')
    // An ABSENT node — what the walk carries on past a node the server did not write — is
    // refused here too, in the unit that needed it, rather than by the walk.
    expect(() => elementHere(undefined, 'p')).toThrow('41.10')
    expect(() => regionFound(regionHere(p))).toThrow('41.10')
})

test('the emitted binding walks the markup and adds nothing to the document', async () => {
    const client = await clientOf(SOURCE, ['a', 'b'])
    // Each node is found from the one before it or the one it stands in — the `<div>` from the
    // `<p>`, the `<span>` from the `<div>`, the `<button>` from the `<span>` — so nothing is added
    // to the document to find any of them.
    expect(client).toContain('const __c2 = __c0?.nextSibling\n')
    expect(client).toContain('const __c3 = __c2?.firstChild\n')
    expect(client).toContain('const __c5 = __c3?.nextSibling\n')
    // `{b} tail` carries a static piece, so it always renders a node — but it is live, so it can
    // hold markup (32.26) and is stepped to its closing anchor where it does, and never put back.
    // `{a}` is every part an expression and can render none, so the walk puts one back as it
    // passes.
    expect(client).toContain('const __c4 = __runHere(__c3?.firstChild, null)\n')
    expect(client).toContain('const __c1 = __runHere(__c0?.firstChild, __c0)')
    expect(client).toContain('__elementHere(__c5, "button").addEventListener')
    expect(client).not.toContain('data-a')
    expect(client).not.toContain('slots(')
    // RESOLVED ONCE AT MOUNT, and the binding writes the node it holds. THE REVERT: emit
    // `setText(textHere(…), …)` inside the watch; every write then re-checks the node it already
    // holds.
    expect(client).toContain('let __t4 = __textHere(__c4)')
    expect(client).toContain('__setText(__t4,')
    expect(client).not.toContain('__setText(__textHere(')
})

// THE WALK IS SHARED BECAUSE IT IS ONE WALK. Four bindings under one parent reach it once, and
// each is one step from its neighbour — where walking every binding alone from the root was
// measured at 2.3x a marker walk on a wide tree (`depth.spec.ts`).
//
// Nothing to revert: sharing is not a pass over the bindings any more but the shape of the walk,
// so what this holds is that every position is found exactly once.
test('bindings under one parent share the walk to it', async () => {
    const source = `<script>
import { reactive } from 'abide'
let a = reactive(1)
let b = reactive(2)
let c = reactive(3)
</script>
<section><div><p>{a}</p><p>{b}</p><p>{c}</p></div></section>`

    const client = await clientOf(source, ['a', 'b', 'c'])
    expect(client).toContain('const __c1 = __c0?.firstChild\n')
    expect(client).toContain('const __c2 = __c1?.firstChild\n')
    expect(client).toContain('const __c4 = __c2?.nextSibling\n')
    expect(client).toContain('const __c6 = __c4?.nextSibling\n')
    // Eight positions — the section, the div, three `<p>` and their runs — and eight steps.
    expect(client.match(/const __c\d+ =/g) ?? []).toHaveLength(8)
})
