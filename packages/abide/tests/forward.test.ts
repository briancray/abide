// FORWARD PRESSURE — the smallest case for a clause that is NOT BUILT YET, written to find out
// whether what is built can grow into it. It is not a coverage test and it is not a regression
// test; it is the question "is today's shape a step toward the design, or away from it" asked
// while the answer is still cheap.
//
// This one says AWAY, and that is worth more than a passing test. Slots are addressed by their
// index in DOCUMENT ORDER over the whole page, which is exact for a static template and
// meaningless the moment the document's shape depends on a value: `{#if}` (32.13) removes a
// region and shifts every index after it, `{#for}` (32.14) repeats one N times, and 32.16 does
// it as chunks ARRIVE. The scheme cannot be extended to any of the three. It has to be replaced
// by addressing that is relative to a region rather than to the page, and knowing that now is
// what stops the next change optimising a shape that must be thrown away.

import { afterAll, expect, test } from 'bun:test'
import { emitClient, parseAbide } from '#compiler'
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

test('a slot absent at runtime breaks every index after it — 32.13 and 32.14 are blocked', async () => {
    const client = emitClient(parseAbide(SOURCE), new Set(['a', 'b', 'c']))
    // Three slots, numbered by where they stand in the source.
    expect(client).toContain('slotNodes[2]')

    const dir = temporaryModule({ 'P.client.ts': client })
    const { default: mount } = await import(`${dir}/P.client.ts`)

    // What the server writes when the middle region did not render — exactly what an `{#if}`
    // false branch produces, and what every row of a `{#for}` multiplies.
    document.body.innerHTML =
        '<p id="a"><!--a-->A<!--/a--></p><p id="b"></p><p id="c"><!--a-->C<!--/a--></p>'

    // THE CURRENT ANSWER, asserted so that FIXING the addressing fails this test and forces it to
    // be rewritten. Two slots are in the document and the third binding indexes past the end, so
    // mounting throws rather than merely writing the wrong node — the page does not render at all.
    expect(() => mount(document.body)).toThrow()
})
