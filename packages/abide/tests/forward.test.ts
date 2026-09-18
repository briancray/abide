// FORWARD PRESSURE — the smallest case for a clause that is NOT BUILT YET, written to find out
// whether what is built can grow into it. Not coverage, not regression: the question "is today's
// shape a step toward the design or away from it", asked while the answer is still cheap.
//
// It said AWAY once already, and that finding is what this file is for. Slots used to be
// addressed by their position in DOCUMENT ORDER over the whole page, which is exact for a static
// template and meaningless the moment the document's shape depends on a value — `{#if}` removes a
// region and shifted every slot after it (32.13), `{#for}` repeats one N times (32.14), 32.16
// does it as chunks arrive. Rendering an absent region did not write the wrong node; it THREW,
// and the page did not render at all.
//
// The number now lives IN the marker and the walk is bounded to a region, so what follows is the
// property that had to hold before any of the three clauses can be built.

import { afterAll, expect, test } from 'bun:test'
import { emitClient, parseAbide } from '#compiler'
import { slotAt, slots } from '#ui'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

afterAll(removeTemporaryModules)

const SOURCE = `<script>
import { reactive } from 'abide'
let a = reactive('A')
let b = reactive('B')
let c = reactive('C')
</script>
<p id="a">{a}</p>
<p id="b">{b}</p>
<p id="c">{c}</p>`

// What the server writes when the MIDDLE region did not render — exactly what an `{#if}` false
// branch produces, and what every row of a `{#for}` multiplies.
const MIDDLE_ABSENT =
    '<p id="a"><!--a0-->A<!--/a--></p><p id="b"></p><p id="c"><!--a2-->C<!--/a--></p>'

// THE PROPERTY 32.13 AND 32.14 NEED. An absent slot is absent; it does not renumber the slots
// after it. THE REVERT: make `slots()` match a bare `a` marker and index by the order the markers
// are met — the scheme this replaced. It reports `undefined` for slot 0 and for every other slot
// on the page, because a numbered marker is not the name it is now looking for; with the emitter
// reverted alongside it, the same walk reports `C` bound to the `b` position instead, which is a
// page that renders with every value one place to the left.
//
// ASSERT THE ANCHOR WHEN INSTALLING A REVERT. This one was written against an unformatted line,
// did not apply, and the gate read as passing with the mechanism out — which is the one thing a
// gate must never do.
test('an absent slot does not shift the slots after it', () => {
    document.body.innerHTML = MIDDLE_ABSENT
    const found = slots(document.body)

    expect(found[0]?.data).toBe('A')
    expect(found[1]).toBeUndefined()
    expect(found[2]?.data).toBe('C')
})

// 41.11 — a binding reaching a slot the document does not carry is a client and a server
// disagreeing about a region's shape. THE REVERT: index `slotNodes` directly instead of through
// `slotAt`; the failure is then `undefined is not an object (evaluating 'node.data')`, which
// names neither the slot nor the page.
test('a binding for a slot the document does not carry names the slot', () => {
    document.body.innerHTML = MIDDLE_ABSENT
    const found = slots(document.body)
    expect(() => slotAt(found, 1)).toThrow('slot 1')
    expect(() => slotAt(found, 1)).toThrow('41.11')
})

test('the emitted binding goes through the checked lookup', () => {
    const client = emitClient(parseAbide(SOURCE), new Set(['a', 'b', 'c']))
    expect(client).toContain('setText(slotAt(slotNodes, 2), c())')
})

// STILL NOT BUILT, and this is the next thing forward pressure should be applied to: a region
// numbers its own slots from zero, so two rows of a `{#for}` both hold `a0` and neither may see
// the other's. `slots()` takes a region root and walks only within it, which is what makes that
// possible — but nothing emits a nested region yet, so nothing proves it.
test('a region walk sees only its own slots', async () => {
    document.body.innerHTML =
        '<div id="row1"><!--a0-->one<!--/a--></div><div id="row2"><!--a0-->two<!--/a--></div>'
    const first = slots(document.querySelector('#row1') as HTMLElement)
    const second = slots(document.querySelector('#row2') as HTMLElement)

    expect(first[0]?.data).toBe('one')
    expect(second[0]?.data).toBe('two')
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
})
